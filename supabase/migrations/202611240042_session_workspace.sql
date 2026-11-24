-- Atomic court + extras finalization; keyset history fetched only on demand.
create function app_private.finish_session_bundle(sid uuid,expected_revision bigint,court text,extras jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions; actor uuid; eid uuid; total bigint; x jsonb;
begin
 if jsonb_typeof(extras) is distinct from 'array' or jsonb_array_length(extras)>199 then raise exception 'Invalid extras';end if;
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 if actor is distinct from s.collector_member_id or s.status<>'planned' or s.revision<>expected_revision then raise exception 'Chưa thể hoàn tất buổi';end if;
 if s.collector_member_id is null then raise exception 'Cần có người tính tiền trước';end if;

 update public.session_attendees set rsvp='not_going',commit_source='auto_not_going' where session_id=sid and committed_at is null;
 if not exists(select 1 from public.session_attendees where session_id=sid and rsvp='going' and committed_at is not null and removed_at is null) then raise exception 'Chưa có người chốt tham gia';end if;
 total:=court::bigint;if total<0 or total>1000000000000 then raise exception 'Tiền sân không hợp lệ';end if;
 select id into eid from public.expenses where session_id=sid and kind='court' and status='active';
 if eid is null then insert into public.expenses(session_id,title,kind,amount,paid_by,created_by,split_mode) values(sid,'Tiền sân','court',total,actor,auth.uid(),'weighted') returning id into eid;
 else update public.expenses set amount=total where id=eid;end if;
 delete from public.expense_split_inputs where expense_id=eid;
 insert into public.expense_split_inputs(expense_id,member_id,weight) select eid,member_id,weight from public.session_attendees where session_id=sid and rsvp='going' and committed_at is not null and removed_at is null;
 update public.sessions set status='played',costs_finalized_at=now(),collector_nominee_member_id=null where id=sid;
 update public.approval_requests set status='cancelled' where session_id=sid and type='collector_nomination' and status='pending';

 insert into app_private.session_construction_context values(txid_current(),auth.uid(),sid);
 for x in select value from jsonb_array_elements(extras) loop
  if coalesce(x->>'expense_id','')<>'' then raise exception 'Only new extras at finalization';end if;
  perform app_private.save_expense(sid,expected_revision,x);
 end loop;
 delete from app_private.session_construction_context where transaction_id=txid_current() and actor_id=auth.uid() and session_id=sid;
 perform public.recalculate_session(sid,'Hoàn tất buổi chơi và phụ phí');
end $$;

revoke all on function app_private.finish_session_bundle(uuid,bigint,text,jsonb) from public,anon,authenticated,service_role;

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
 when 'finish_session_bundle' then allowed:=array['sid','expected_revision','court','extras'];sid:=(body->>'sid')::uuid;
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
 when 'finish_session_bundle' then perform app_private.finish_session_bundle(sid,(body->>'expected_revision')::bigint,body->>'court',body->'extras');
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

create or replace function public.session_details_core(sid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.sessions;result jsonb;
begin
 select * into s from public.sessions where id=sid;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền xem buổi';end if;
 result:=jsonb_build_object('id',s.id,'group_id',s.group_id,'title',s.title,'venue',s.venue,'starts_at',s.starts_at,'commit_deadline',s.commit_deadline,'status',s.status,'revision',s.revision::text,'deadline_passed',now()>=s.commit_deadline,'collector_member_id',s.collector_member_id,
 'my_member_id',(select id from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active'),
 'attendees',(select coalesce(jsonb_agg(jsonb_build_object('member_id',a.member_id,'name',m.display_name,'rsvp',a.rsvp,'weight',a.weight::text,'committed_at',a.committed_at,'removed_at',a.removed_at)),'[]') from public.session_attendees a join public.group_members m on m.id=a.member_id where a.session_id=sid),
 'expenses',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'kind',e.kind,'amount',e.amount::text,'paid_by',e.paid_by,'split_mode',e.split_mode,'category_id',e.category_id,'category_name',(select name from public.group_expense_categories where id=e.category_id),'note',e.note,'paid_by_name',(select display_name from public.group_members where id=e.paid_by),'created_by_name',(select display_name from public.group_members where group_id=s.group_id and user_id=e.created_by limit 1),'allocations',(select coalesce(jsonb_agg(jsonb_build_object('member_id',a.member_id,'amount',a.share_amount::text)),'[]') from public.expense_allocations a where a.expense_id=e.id)) order by e.created_at),'[]') from public.expenses e where e.session_id=sid and e.status='active'),
 'settlements',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'from_member',p.from_member,'to_member',p.to_member,'from_name',f.display_name,'to_name',t.display_name,'amount',p.amount::text,'ref_code',p.ref_code,'status',p.status,'kind',p.kind,'bank_bin',case when t.user_id is null then guest.bank_bin else bank.bank_bin end,'bank_account_no',case when t.user_id is null then guest.bank_account_no else bank.bank_account_no end,'bank_account_name',case when t.user_id is null then guest.bank_account_name else bank.bank_account_name end) order by p.created_at),'[]') from public.settlements p join public.group_members f on f.id=p.from_member join public.group_members t on t.id=p.to_member left join public.profiles bank on bank.id=t.user_id and t.status='active' left join public.guest_bank_accounts guest on guest.member_id=t.id and t.user_id is null and t.status='active' where p.session_id=sid and p.status<>'cancelled'),
 'history','[]'::jsonb);return result;
end $$;
revoke all on function public.session_details_core(uuid) from public,anon,authenticated,service_role;


create function public.session_history_page(sid uuid,before_time timestamptz default null,before_id uuid default null,page_size integer default 20) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g uuid; entries jsonb;
begin
 select group_id into g from public.sessions where id=sid;
 if g is null or not public.is_member(g) then raise exception 'Không có quyền xem lịch sử'; end if;
 if page_size not between 1 and 50 or page_size is null or ((before_time is null)<>(before_id is null)) then raise exception 'Trang không hợp lệ'; end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc),'[]'::jsonb) into entries from (
  select a.id,a.created_at,a.action,a.reason,
   coalesce((select m.display_name from public.group_members m where m.group_id=g and m.user_id=a.actor_id limit 1),case when a.actor_id is null then 'Hệ thống' else 'Thành viên' end) actor_name
  from (
   select id,created_at,action,payload->>'reason' reason,actor_id from public.audit_log where session_id=sid and action<>'allocation_snapshot'
   union all
   select id,created_at,action,reason,actor_id from public.attendance_events where session_id=sid
  ) a where (before_time is null or (a.created_at,a.id)<(before_time,before_id))
  order by a.created_at desc,a.id desc limit page_size+1
 ) p;
 return jsonb_build_object('items',entries,'has_more',jsonb_array_length(entries)>page_size);
end $$;
revoke all on function public.session_history_page(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.session_history_page(uuid,timestamptz,uuid,integer) to authenticated;
create index if not exists audit_session_page on public.audit_log(session_id,created_at desc,id desc);

-- The legacy wrapper used to aggregate all history, overriding the core value.
create or replace function public.session_details_before_calendar(sid uuid) returns jsonb language sql stable security definer set search_path='' as $$select public.session_details_core(sid)$$;

create index if not exists attendance_session_page on public.attendance_events(session_id,created_at desc,id desc);
