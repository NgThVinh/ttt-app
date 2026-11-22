create table app_private.session_construction_context(transaction_id bigint not null,actor_id uuid not null,session_id uuid not null,primary key(transaction_id,actor_id,session_id));
alter table app_private.session_construction_context enable row level security;
revoke all on app_private.session_construction_context from public,anon,authenticated,service_role;
create function app_private.constructing(sid uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from app_private.session_construction_context where transaction_id=txid_current() and actor_id=auth.uid() and session_id=sid)$$;
revoke all on function app_private.constructing(uuid) from public,anon,authenticated,service_role;
create function app_private.create_session_bundle(body jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid;g uuid:=(body->>'g')::uuid;actor uuid;people uuid[];court bigint;eid uuid;x jsonb;pair record;candidate uuid;start_time timestamptz;deadline timestamptz;played boolean;
begin
 if not public.is_member(g) then raise exception 'Không có quyền';end if;
 if jsonb_typeof(body->'extras') is distinct from 'array' or jsonb_array_length(body->'extras')>199 or jsonb_typeof(body->'weights') is distinct from 'object' or jsonb_typeof(body->'people') is distinct from 'array' then raise exception 'Danh sách khoản chi hoặc hệ số không hợp lệ';end if;
 played:=(body->>'already_played')::boolean;candidate:=nullif(body->>'nominee','')::uuid;
 if played is null or jsonb_typeof(body->'be_collector') is distinct from 'boolean' then raise exception 'Thông tin buổi không hợp lệ';end if;
 if not played then
  if jsonb_array_length(body->'extras')>0 or jsonb_array_length(body->'people')>0 or body->'weights'<>'{}'::jsonb or (candidate is not null and (body->>'be_collector')::boolean) then raise exception 'Buổi đặt trước chưa nhập chi phí hoặc chốt hộ';end if;
  sid:=app_private.create_session(g,body->>'title_text',body->>'venue_text',(body->>'start_time')::timestamptz,(body->>'deadline')::timestamptz,false,'{}',body->>'court',(body->>'be_collector')::boolean);
  if candidate is not null then perform public.request_session_change(sid,'collector_nomination',jsonb_build_object('member_id',candidate,'reason','Đề cử khi đặt lịch'));end if;
  return sid;
 end if;
 select id into actor from public.group_members where group_id=g and user_id=auth.uid() and status='active';
 people:=array(select jsonb_array_elements_text(body->'people'))::uuid[];start_time:=(body->>'start_time')::timestamptz;deadline:=(body->>'deadline')::timestamptz;
 if candidate is not null or not(body->>'be_collector')::boolean or coalesce(length(trim(body->>'title_text')),0) not between 1 and 160 or coalesce(length(trim(body->>'venue_text')),0) not between 1 and 200 or start_time is null or deadline is null or not isfinite(start_time) or not isfinite(deadline) or start_time>now() or deadline>start_time or cardinality(people) not between 1 and 100 or cardinality(people)<>(select count(distinct p) from unnest(people) p) then raise exception 'Thông tin buổi đã chơi không hợp lệ';end if;
 if exists(select 1 from unnest(people) p where not exists(select 1 from public.group_members where id=p and group_id=g and status='active')) then raise exception 'Danh sách người tham gia không hợp lệ';end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and coalesce(bank_bin,'')<>'' and coalesce(bank_account_no,'')<>'' and coalesce(bank_account_name,'')<>'') then raise exception 'Người tính tiền cần ngân hàng';end if;
 if body->>'court' is null or body->>'court' !~ '^[0-9]+$' then raise exception 'Tiền sân không hợp lệ';end if;
 court:=(body->>'court')::bigint;if court>1000000000000 then raise exception 'Tiền sân vượt giới hạn';end if;
 if(select count(*) from jsonb_object_keys(body->'weights'))>100 then raise exception 'Quá nhiều hệ số';end if;
 for pair in select * from jsonb_each_text(body->'weights') loop
  if pair.key::uuid<>all(people) or pair.value is null or length(pair.value)>12 or pair.value !~ '^[0-9]+([.][0-9]{1,6})?$' or pair.value::numeric<=0 or pair.value::numeric>100 then raise exception 'Hệ số không hợp lệ';end if;
 end loop;
 insert into public.sessions(group_id,title,venue,starts_at,commit_deadline,status,collector_member_id,created_by) values(g,trim(body->>'title_text'),trim(body->>'venue_text'),start_time,deadline,'played',actor,auth.uid()) returning id into sid;
 insert into public.session_attendees(session_id,member_id,rsvp,committed_at,commit_source,weight) select sid,p,'going',now(),'added_by_collector',coalesce((body->'weights'->>p::text)::numeric,1) from unnest(people) p;
 insert into public.attendance_events(session_id,member_id,actor_id,action,after,reason,session_status_at_time) select sid,a.member_id,auth.uid(),'added_by_collector',jsonb_build_object('weight',a.weight::text),'Tạo buổi đã chơi','played' from public.session_attendees a where a.session_id=sid;
 insert into public.expenses(session_id,title,kind,amount,paid_by,created_by,split_mode) values(sid,'Tiền sân','court',court,actor,auth.uid(),'weighted') returning id into eid;
 insert into public.expense_split_inputs(expense_id,member_id,weight) select eid,member_id,weight from public.session_attendees where session_id=sid;
 insert into app_private.session_construction_context values(txid_current(),auth.uid(),sid);
 for x in select value from jsonb_array_elements(body->'extras') loop
  perform app_private.save_expense(sid,0,x||jsonb_build_object('expense_id','','reason','Tạo buổi đã chơi'));
 end loop;
 delete from app_private.session_construction_context where transaction_id=txid_current() and actor_id=auth.uid() and session_id=sid;
 perform public.recalculate_session(sid,'Tạo buổi đã chơi và phụ phí');
 insert into public.audit_log(group_id,session_id,actor_id,action) values(g,sid,auth.uid(),'session_created');
 perform public.notify_group(g,'session-created:'||sid,'Đã tạo buổi: '||trim(body->>'title_text')||'. Xem phần chia và công nợ.','/sessions/'||sid);
 return sid;
end $$;
revoke all on function app_private.create_session_bundle(jsonb) from public,anon,authenticated,service_role;

create or replace function public.write_expense_internal(sid uuid,expected_revision bigint,title_text text,raw_amount text,payer uuid,beneficiaries uuid[],mode text,split text,values_text text[],reason text default '',activate_id uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions; eid uuid; total bigint; i integer; ratio numeric; sum_ratio numeric:=0;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Chỉ người tính tiền được nhập khoản chi';end if;
 if s.revision<>expected_revision then raise exception 'Buổi đã thay đổi. Vui lòng tải lại để xem trước';end if;
 if s.status='cancelled' or (public.session_is_locked(s.id)) then raise exception 'Buổi đã khóa';end if;
 if s.status='planned' then raise exception 'Hoàn tất buổi trước khi nhập chi phí';end if;
 if exists(select 1 from public.settlements where session_id=sid) and coalesce(length(trim(reason)),0) not between 1 and 500 then raise exception 'Cần lý do thay đổi sau khi đã có khoản thu';end if;
 if length(trim(title_text)) not between 1 and 160 or cardinality(beneficiaries) not between 1 and 100 or cardinality(beneficiaries)<>(select count(distinct x) from unnest(beneficiaries) x) or mode not in ('total','per_person') or split not in ('equal','weighted','exact','percent') then raise exception 'Khoản chi không hợp lệ';end if;
 if activate_id is null and (select count(*) from public.expenses where session_id=sid and status in ('active','proposed'))>=200 then raise exception 'Tối đa 200 khoản chi';end if;
 if (not exists(select 1 from public.session_attendees where session_id=sid and member_id=payer and rsvp='going' and removed_at is null) and not exists(select 1 from public.expenses where id=activate_id and kind='court' and payer=s.collector_member_id)) or exists(select 1 from unnest(beneficiaries) x where not exists(select 1 from public.session_attendees where session_id=sid and member_id=x and rsvp='going' and removed_at is null)) then raise exception 'Người ứng và người chịu phải tham gia buổi';end if;
 total:=raw_amount::bigint;if abs(total::numeric)>1000000000000 then raise exception 'Số tiền vượt giới hạn';end if;if mode='per_person' then total:=total*cardinality(beneficiaries);end if;
 if split in ('exact','percent') and cardinality(values_text)<>cardinality(beneficiaries) then raise exception 'Nhập đủ các phần chia';end if;
 if activate_id is null then insert into public.expenses(session_id,title,amount,paid_by,created_by,amount_mode,split_mode,unit_amount) values(sid,trim(title_text),total,payer,auth.uid(),mode,split,case when mode='per_person' then raw_amount::bigint else null end) returning id into eid; else update public.expenses set status='active',amount=total,title=trim(title_text),paid_by=payer,amount_mode=mode,split_mode=split,unit_amount=case when mode='per_person' then raw_amount::bigint else null end where id=activate_id and session_id=sid and status='proposed' returning id into eid; if not found then raise exception 'Đề xuất đã thay đổi';end if;end if;
 for i in 1..cardinality(beneficiaries) loop
 ratio:=case when split='equal' then 1 when split='weighted' then (select weight from public.session_attendees where session_id=sid and member_id=beneficiaries[i]) else values_text[i]::numeric end;
 if ratio<0 or ratio<>round(ratio,6) or ratio>100000000000000 then raise exception 'Phần chia không hợp lệ';end if;
 sum_ratio:=sum_ratio+ratio;
 insert into public.expense_split_inputs values(eid,beneficiaries[i],ratio,now());
 end loop;
 if (split='percent' and sum_ratio<>100) or (split='exact' and sum_ratio<>abs(total::numeric)) then raise exception 'Tổng phần chia không khớp';end if;
 if sum_ratio=0 then update public.expense_split_inputs set weight=1 where expense_id=eid;end if;
 if not app_private.constructing(sid) then perform public.recalculate_session(sid,reason);end if;
end $$;



create or replace function app_private.save_expense(sid uuid,expected_revision bigint,body jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.sessions;e public.expenses;r public.approval_requests;actor uuid;eid uuid;category uuid;prior_ids uuid[];prior jsonb;proposal_payload jsonb;direct boolean;title_text text;raw_amount text;payer uuid;beneficiaries uuid[];mode text;split text;values_text text[];why text;note_text text;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) or s.status not in('played','settled') or public.session_is_locked(sid) or expected_revision is null or s.revision<>expected_revision then raise exception 'Không có quyền, buổi đã khóa hoặc đã thay đổi';end if;
 if body is null or jsonb_typeof(body)<>'object' or jsonb_typeof(body->'beneficiaries') is distinct from 'array' or jsonb_typeof(body->'values_text') is distinct from 'array' then raise exception 'Khoản chi không hợp lệ';end if;
 why:=trim(body->>'reason');note_text:=trim(body->>'note_text');
 if coalesce(length(why),0) not between 1 and 500 or note_text is null or length(note_text)>2000 then raise exception 'Cần lý do, ghi chú tối đa 2000 ký tự';end if;
 update public.expenses set status='rejected' where status='proposed' and session_id=sid and approval_request_id in(select id from public.approval_requests where session_id=sid and status='pending' and expires_at<=now());
 update public.approval_requests set status='expired' where session_id=sid and status='pending' and expires_at<=now();
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 eid:=nullif(body->>'expense_id','')::uuid;category:=nullif(body->>'category_id','')::uuid;
 title_text:=trim(body->>'title_text');raw_amount:=body->>'raw_amount';payer:=(body->>'payer')::uuid;beneficiaries:=array(select jsonb_array_elements_text(body->'beneficiaries'))::uuid[];mode:=body->>'mode';split:=body->>'split';values_text:=array(select jsonb_array_elements_text(body->'values_text'));
 if eid is not null then select * into e from public.expenses where id=eid and session_id=sid for update;if not found or e.status not in('active','proposed') then raise exception 'Khoản chi đã thay đổi';end if;prior:=to_jsonb(e);end if;
 if category is not null and not exists(select 1 from public.group_expense_categories where id=category and group_id=s.group_id and (active or id=e.category_id)) then raise exception 'Danh mục không thuộc nhóm hoặc đã ngừng dùng';end if;
 direct:=coalesce(actor=s.collector_member_id,false) or app_private.admin_context(sid,'save_expense');
 if e.kind='court' then
  if raw_amount::numeric<0 then raise exception 'Court amount cannot be negative';end if;
  if not direct then raise exception 'Chỉ người tính tiền sửa tiền sân';end if;
  payer:=s.collector_member_id;mode:='total';split:='weighted';category:=null;
  beneficiaries:=array(select member_id from public.session_attendees where session_id=sid and rsvp='going' and removed_at is null order by member_id);
 end if;
 if not direct then
  if not exists(select 1 from public.session_attendees where session_id=sid and member_id=actor and rsvp='going' and removed_at is null) then raise exception 'Chỉ người tham gia được nhập khoản chi';end if;
  if eid is not null and e.created_by is distinct from auth.uid() then raise exception 'Chỉ sửa đề xuất hoặc khoản tự chịu của chính mình';end if;
  if e.status='active' and (cardinality(beneficiaries)<>1 or beneficiaries[1]<>actor or (select count(*) from public.expense_split_inputs where expense_id=eid)<>1 or not exists(select 1 from public.expense_split_inputs where expense_id=eid and member_id=actor)) then raise exception 'Khoản có người khác chịu cần người tính tiền sửa';end if;
  direct:=cardinality(beneficiaries)=1 and beneficiaries[1]=actor;
 end if;
 if e.status='proposed' then
  select * into r from public.approval_requests where id=e.approval_request_id for update;
  if r.status<>'pending' or r.expires_at<=now() or r.payload_hash<>encode(sha256(convert_to(r.payload::text,'UTF8')),'hex') then raise exception 'Đề xuất đã đổi hoặc hết hạn';end if;
 end if;
 select coalesce(array_agg(id),'{}') into prior_ids from public.expenses where session_id=sid;
 if direct then
  if eid is not null then update public.expenses set status='proposed' where id=eid;delete from public.expense_split_inputs where expense_id=eid;end if;
  perform public.write_expense_internal(sid,expected_revision,title_text,raw_amount,payer,beneficiaries,mode,split,values_text,why,eid);
  if eid is null then select id into eid from public.expenses where session_id=sid and id<>all(prior_ids);end if;
  if r.id is not null then update public.approval_requests set status='cancelled',decided_by=auth.uid(),decided_at=now(),decision_note=why where id=r.id;end if;
 else
  begin
   if eid is not null then delete from public.expense_split_inputs where expense_id=eid;end if;
   perform public.write_expense_internal(sid,expected_revision,title_text,raw_amount,payer,beneficiaries,mode,split,values_text,why,eid);
   raise exception using errcode='PT005',message='validate proposal';
  exception when sqlstate 'PT005' then null;end;
  if eid is null then
   insert into public.expenses(session_id,title,amount,paid_by,created_by,status,amount_mode,split_mode,unit_amount,note,category_id) values(sid,title_text,raw_amount::bigint*case when mode='per_person' then cardinality(beneficiaries) else 1 end,payer,auth.uid(),'proposed',mode,split,case when mode='per_person' then raw_amount::bigint else null end,note_text,category) returning id into eid;
  else update public.expenses set title=title_text,amount=raw_amount::bigint*case when mode='per_person' then cardinality(beneficiaries) else 1 end,paid_by=payer,amount_mode=mode,split_mode=split,unit_amount=case when mode='per_person' then raw_amount::bigint else null end,note=note_text,category_id=category where id=eid;end if;
  proposal_payload:=jsonb_build_object('expense_id',eid,'title',title_text,'amount',raw_amount,'payer',payer,'beneficiaries',beneficiaries,'mode',mode,'split',split,'values',values_text,'reason',why,'note',note_text,'category_id',category,'baseline_revision',s.revision::text);
  if r.id is null then
   r.id:=public.new_session_request(sid,'expense_proposal',proposal_payload,s.collector_member_id::text);update public.expenses set approval_request_id=r.id where id=eid;
  else update public.approval_requests set payload=proposal_payload,payload_hash=encode(sha256(convert_to(proposal_payload::text,'UTF8')),'hex'),session_revision=s.revision,required_authority=s.collector_member_id::text,expires_at=now()+interval '72 hours' where id=r.id;end if;
 end if;
 update public.expenses set note=note_text,category_id=category where id=eid;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,sid,auth.uid(),case when prior is null then 'expense_saved' else 'expense_edited' end,jsonb_build_object('expense_id',eid,'reason',why,'before',prior,'after',(select to_jsonb(ex) from public.expenses ex where ex.id=eid)));
 if not app_private.constructing(sid) then perform public.notify_group(s.group_id,'expense-edit:'||gen_random_uuid(),'Khoản chi đã được thêm hoặc cập nhật; xem phần chia và lịch sử.','/sessions/'||sid);end if;
 return eid;
end $$;
revoke all on function app_private.save_expense(uuid,bigint,jsonb) from public,anon,authenticated,service_role;

create or replace function public.execute_financial_command(command_name text,request_key uuid,body jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); g uuid; sid uuid; before_batch uuid; after_batch uuid;
 fingerprint text; receipt app_private.financial_command_results; result jsonb;
 allowed text[]; field text; revision bigint; created uuid;
begin
 if actor is null or request_key is null or body is null or jsonb_typeof(body)<>'object' then raise exception 'Yêu cầu không hợp lệ';end if;
 case command_name
 when 'create_session_bundle' then allowed:=array['g','title_text','venue_text','start_time','deadline','already_played','people','court','be_collector','weights','extras','nominee'];g:=(body->>'g')::uuid;
 when 'create_session' then allowed:=array['g','title_text','venue_text','start_time','deadline','already_played','people','court','be_collector']; g:=(body->>'g')::uuid;
 when 'add_expense' then allowed:=array['sid','expected_revision','title_text','raw_amount','payer','beneficiaries','mode','split','values_text','reason'];sid:=(body->>'sid')::uuid;
 when 'save_expense' then allowed:=array['sid','expected_revision','expense_id','category_id','note_text','title_text','raw_amount','payer','beneficiaries','mode','split','values_text','reason'];sid:=(body->>'sid')::uuid;
 when 'apply_financial_change' then allowed:=array['sid','expected_revision','action_name','body'];sid:=(body->>'sid')::uuid;
 when 'finish_session' then allowed:=array['sid','expected_revision','court'];sid:=(body->>'sid')::uuid;
 when 'claim_collector' then allowed:=array['sid','expected_revision','court'];sid:=(body->>'sid')::uuid;
 when 'payment_action' then allowed:=array['target','operation'];select session_id into sid from public.settlements where id=(body->>'target')::uuid;
 when 'decide_session_request' then allowed:=array['request_id','approve','expected_hash'];select session_id into sid from public.approval_requests where id=(body->>'request_id')::uuid;
 else raise exception 'Thao tác tiền không hợp lệ';
 end case;
 if not(body ?& allowed) or exists(select 1 from jsonb_object_keys(body) k where not(k=any(allowed))) then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
 foreach field in array allowed loop
  if jsonb_typeof(body->field)='null' then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
  if field in ('people','beneficiaries','values_text','extras') then
   if jsonb_typeof(body->field)<>'array' then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
  elsif field in('body','weights') then
   if jsonb_typeof(body->field)<>'object' then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
  elsif field in ('already_played','be_collector','approve') then
   if jsonb_typeof(body->field)<>'boolean' then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
  elsif field='expected_revision' then
   if jsonb_typeof(body->field) not in ('string','number') then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
  elsif jsonb_typeof(body->field)<>'string' then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
 end loop;
 if command_name not in('create_session','create_session_bundle') then select group_id into g from public.sessions where id=sid;end if;
 if g is null or not public.is_member(g) then raise exception 'Không có quyền';end if;
 -- The key is scoped to this actor across all commands. A successful retry is
 -- an acknowledgement of the original result, never a second execution.
 perform pg_advisory_xact_lock(hashtextextended('3t-financial-command:'||actor||':'||request_key,0));
 if not public.is_member(g) then raise exception 'Không có quyền';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('command',command_name,'body',body)::text,'UTF8')),'hex');
 select * into receipt from app_private.financial_command_results r where r.actor_id=actor and r.request_key=execute_financial_command.request_key;
 if found then
  if receipt.payload_hash<>fingerprint or receipt.command_name<>execute_financial_command.command_name then raise exception 'Mã yêu cầu đã dùng cho nội dung khác';end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 if sid is not null then select last_recalculation_id into before_batch from public.sessions where id=sid for update;end if;
 if body ? 'expected_revision' and coalesce(body->>'expected_revision','') !~ '^[0-9]+$' then raise exception 'Phiên bản buổi không hợp lệ';end if;
 case command_name
 when 'create_session_bundle' then sid:=app_private.create_session_bundle(body);created:=sid;
 when 'create_session' then
  if jsonb_typeof(body->'people')<>'array' or jsonb_typeof(body->'already_played')<>'boolean' or jsonb_typeof(body->'be_collector')<>'boolean' then raise exception 'Thông tin buổi không hợp lệ';end if;
  sid:=app_private.create_session(g,body->>'title_text',body->>'venue_text',(body->>'start_time')::timestamptz,(body->>'deadline')::timestamptz,(body->>'already_played')::boolean,array(select jsonb_array_elements_text(body->'people'))::uuid[],body->>'court',(body->>'be_collector')::boolean);created:=sid;
 when 'add_expense' then
  if jsonb_typeof(body->'beneficiaries')<>'array' or jsonb_typeof(body->'values_text')<>'array' then raise exception 'Khoản chi không hợp lệ';end if;
  perform app_private.add_expense(sid,(body->>'expected_revision')::bigint,body->>'title_text',body->>'raw_amount',(body->>'payer')::uuid,array(select jsonb_array_elements_text(body->'beneficiaries'))::uuid[],body->>'mode',body->>'split',array(select jsonb_array_elements_text(body->'values_text')),body->>'reason');
 when 'save_expense' then created:=app_private.save_expense(sid,(body->>'expected_revision')::bigint,body);
 when 'apply_financial_change' then
  if jsonb_typeof(body->'body')<>'object' then raise exception 'Thay đổi không hợp lệ';end if;
  perform app_private.apply_financial_change(sid,(body->>'expected_revision')::bigint,body->>'action_name',body->'body');
 when 'finish_session' then perform app_private.finish_session(sid,(body->>'expected_revision')::bigint,body->>'court');
 when 'claim_collector' then perform app_private.claim_collector(sid,(body->>'expected_revision')::bigint,body->>'court');
 when 'payment_action' then perform app_private.payment_action((body->>'target')::uuid,body->>'operation');
 when 'decide_session_request' then
  if jsonb_typeof(body->'approve')<>'boolean' then raise exception 'Quyết định không hợp lệ';end if;
  perform app_private.decide_session_request((body->>'request_id')::uuid,(body->>'approve')::boolean,body->>'expected_hash');
 end case;
 select s.revision,s.last_recalculation_id into revision,after_batch from public.sessions s where s.id=sid;
 result:=jsonb_build_object('id',created,'session_id',sid,'revision',revision::text,'batch_id',case when after_batch is distinct from before_batch then after_batch else null end);
 insert into app_private.financial_command_results(actor_id,request_key,command_name,payload_hash,group_id,session_id,result) values(actor,request_key,command_name,fingerprint,g,sid,result);
 return result||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.execute_financial_command(text,uuid,jsonb) from public,anon,service_role;
grant execute on function public.execute_financial_command(text,uuid,jsonb) to authenticated;


