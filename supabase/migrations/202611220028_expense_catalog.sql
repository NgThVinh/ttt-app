create table public.group_expense_categories(id uuid primary key default gen_random_uuid(),group_id uuid not null references public.groups,name text not null check(length(trim(name)) between 1 and 80),icon text not null default 'other' check(icon in('water','ball','gear','parking','food','discount','other')),sort_order integer not null default 0,active boolean not null default true,created_at timestamptz not null default now());
create unique index expense_category_name on public.group_expense_categories(group_id,lower(name));
create table public.expense_templates(id uuid primary key default gen_random_uuid(),group_id uuid not null references public.groups,title text not null check(length(trim(title)) between 1 and 160),category_id uuid references public.group_expense_categories,amount bigint not null check(abs(amount::numeric)<=1000000000000),amount_mode text not null check(amount_mode in('total','per_person')),default_split text not null check(default_split in('equal','weighted')),active boolean not null default true,created_at timestamptz not null default now());
create unique index expense_template_name on public.expense_templates(group_id,lower(title));
alter table public.expenses add column category_id uuid references public.group_expense_categories;
alter table public.group_expense_categories enable row level security;
alter table public.expense_templates enable row level security;
revoke all on public.group_expense_categories,public.expense_templates from public,anon,authenticated,service_role;
grant select on public.group_expense_categories,public.expense_templates to authenticated;
create policy category_read on public.group_expense_categories for select to authenticated using(public.is_member(group_id));
create policy template_read on public.expense_templates for select to authenticated using(public.is_member(group_id));
create function app_private.initialize_expense_catalog(g uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.group_expense_categories(group_id,name,icon,sort_order) select g,name,icon,ordinality::integer from unnest(array['Nước uống','Cầu / bóng','Thuê dụng cụ','Gửi xe','Ăn uống','Giảm giá / khuyến mãi','Khác'],array['water','ball','gear','parking','food','discount','other']) with ordinality as defaults(name,icon,ordinality) on conflict do nothing;
 if not exists(select 1 from public.expense_templates where group_id=g) then
  insert into public.expense_templates(group_id,title,category_id,amount,amount_mode,default_split) select g,'Nước 10k/người',id,10000,'per_person','equal' from public.group_expense_categories where group_id=g and icon='water' order by sort_order limit 1;
  insert into public.expense_templates(group_id,title,category_id,amount,amount_mode,default_split) select g,'Gửi xe 5k/người',id,5000,'per_person','equal' from public.group_expense_categories where group_id=g and icon='parking' order by sort_order limit 1;
 end if;
end $$;
create function app_private.seed_group_expense_catalog() returns trigger language plpgsql security definer set search_path='' as $$begin perform app_private.initialize_expense_catalog(new.id);return new;end $$;
revoke all on function app_private.initialize_expense_catalog(uuid),app_private.seed_group_expense_catalog() from public,anon,authenticated,service_role;
create trigger group_expense_defaults after insert on public.groups for each row execute function app_private.seed_group_expense_catalog();
do $$declare g uuid;begin for g in select id from public.groups loop perform app_private.initialize_expense_catalog(g);end loop;end $$;

create function public.save_expense_category(g uuid,target uuid,name_text text,icon_text text,sort_position integer,enabled boolean,reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform 1 from public.groups where id=g for no key update;
 if not public.is_group_admin(g) then raise exception 'Chỉ admin nhóm quản lý danh mục';end if;
 if coalesce(length(trim(name_text)),0) not between 1 and 80 or icon_text is null or icon_text not in('water','ball','gear','parking','food','discount','other') or sort_position is null or sort_position not between 0 and 1000 or enabled is null or coalesce(length(trim(reason)),0) not between 1 and 500 then raise exception 'Danh mục không hợp lệ';end if;
 if target is null then insert into public.group_expense_categories(group_id,name,icon,sort_order,active) values(g,trim(name_text),icon_text,sort_position,enabled) returning id into result;
 else update public.group_expense_categories set name=trim(name_text),icon=icon_text,sort_order=sort_position,active=enabled where id=target and group_id=g returning id into result;if not found then raise exception 'Danh mục không thuộc nhóm';end if;end if;
 insert into public.audit_log(group_id,actor_id,action,payload) values(g,auth.uid(),'expense_category_saved',jsonb_build_object('category_id',result,'reason',trim(reason),'active',enabled));return result;
end $$;
create function public.save_expense_template(g uuid,target uuid,title_text text,category uuid,amount_text text,mode text,split text,enabled boolean,reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform 1 from public.groups where id=g for no key update;
 if not public.is_group_admin(g) then raise exception 'Chỉ admin nhóm quản lý mẫu';end if;
 if coalesce(length(trim(title_text)),0) not between 1 and 160 or amount_text is null or amount_text !~ '^-?[0-9]+$' or abs(amount_text::numeric)>1000000000000 or mode is null or mode not in('total','per_person') or split is null or split not in('equal','weighted') or enabled is null or coalesce(length(trim(reason)),0) not between 1 and 500 then raise exception 'Mẫu không hợp lệ';end if;
 if category is not null and not exists(select 1 from public.group_expense_categories where id=category and group_id=g and active) then raise exception 'Danh mục không hợp lệ';end if;
 if target is null then insert into public.expense_templates(group_id,title,category_id,amount,amount_mode,default_split,active) values(g,trim(title_text),category,amount_text::bigint,mode,split,enabled) returning id into result;
 else update public.expense_templates set title=trim(title_text),category_id=category,amount=amount_text::bigint,amount_mode=mode,default_split=split,active=enabled where id=target and group_id=g returning id into result;if not found then raise exception 'Mẫu không thuộc nhóm';end if;end if;
 insert into public.audit_log(group_id,actor_id,action,payload) values(g,auth.uid(),'expense_template_saved',jsonb_build_object('template_id',result,'reason',trim(reason),'active',enabled));return result;
end $$;
create function public.expense_tools(g uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if not public.is_member(g) then raise exception 'Không có quyền';end if;
 return jsonb_build_object('categories',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'icon',icon,'active',active,'sort_order',sort_order) order by sort_order,name),'[]') from public.group_expense_categories where group_id=g),'templates',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'category_id',category_id,'amount',amount::text,'mode',amount_mode,'split',default_split,'active',active) order by created_at),'[]') from public.expense_templates where group_id=g));end $$;
revoke all on function public.save_expense_category(uuid,uuid,text,text,integer,boolean,text),public.save_expense_template(uuid,uuid,text,uuid,text,text,text,boolean,text),public.expense_tools(uuid) from public,anon,service_role;
grant execute on function public.save_expense_category(uuid,uuid,text,text,integer,boolean,text),public.save_expense_template(uuid,uuid,text,uuid,text,text,text,boolean,text),public.expense_tools(uuid) to authenticated;

create function app_private.save_expense(sid uuid,expected_revision bigint,body jsonb) returns uuid language plpgsql security definer set search_path='' as $$
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
 perform public.notify_group(s.group_id,'expense-edit:'||gen_random_uuid(),'Khoản chi đã được thêm hoặc cập nhật; xem phần chia và lịch sử.','/sessions/'||sid);
 return eid;
end $$;
revoke all on function app_private.save_expense(uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function public.preview_expense_edit(sid uuid,expected_revision bigint,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin begin perform app_private.save_expense(sid,expected_revision,body);result:=public.session_details(sid);raise exception using errcode='PT006',message='expense preview';exception when sqlstate 'PT006' then null;end;return result;end $$;
revoke all on function public.preview_expense_edit(uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function public.preview_expense_edit(uuid,bigint,jsonb) to authenticated;

create function public.expense_editor_data(sid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.sessions;actor uuid;
begin select * into s from public.sessions where id=sid;if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 return(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'kind',e.kind,'status',e.status,'amount',coalesce(e.unit_amount,e.amount)::text,'payer',e.paid_by,'mode',e.amount_mode,'split',e.split_mode,'note',coalesce(e.note,''),'category_id',e.category_id,'beneficiaries',case when e.status='proposed' then r.payload->'beneficiaries' else(select coalesce(jsonb_agg(i.member_id order by i.member_id),'[]') from public.expense_split_inputs i where i.expense_id=e.id) end,'values',case when e.status='proposed' then r.payload->'values' else(select coalesce(jsonb_agg(i.weight::text order by i.member_id),'[]') from public.expense_split_inputs i where i.expense_id=e.id) end,'can_edit',coalesce(actor=s.collector_member_id,false) or(e.created_by=auth.uid() and(e.status='proposed' or((select count(*) from public.expense_split_inputs i where i.expense_id=e.id)=1 and exists(select 1 from public.expense_split_inputs i where i.expense_id=e.id and i.member_id=actor)))))),'[]') from public.expenses e left join public.approval_requests r on r.id=e.approval_request_id where e.session_id=sid and e.status in('active','proposed'));
end $$;
revoke all on function public.expense_editor_data(uuid) from public,anon,service_role;
grant execute on function public.expense_editor_data(uuid) to authenticated;

create or replace function public.execute_financial_command(command_name text,request_key uuid,body jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); g uuid; sid uuid; before_batch uuid; after_batch uuid;
 fingerprint text; receipt app_private.financial_command_results; result jsonb;
 allowed text[]; field text; revision bigint; created uuid;
begin
 if actor is null or request_key is null or body is null or jsonb_typeof(body)<>'object' then raise exception 'Yêu cầu không hợp lệ';end if;
 case command_name
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
  if field in ('people','beneficiaries','values_text') then
   if jsonb_typeof(body->field)<>'array' then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
  elsif field='body' then
   if jsonb_typeof(body->field)<>'object' then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
  elsif field in ('already_played','be_collector','approve') then
   if jsonb_typeof(body->field)<>'boolean' then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
  elsif field='expected_revision' then
   if jsonb_typeof(body->field) not in ('string','number') then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
  elsif jsonb_typeof(body->field)<>'string' then raise exception 'Thông tin yêu cầu không hợp lệ';end if;
 end loop;
 if command_name<>'create_session' then select group_id into g from public.sessions where id=sid;end if;
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


-- Fresh ordinary requests retain their normal 72-hour lifetime.
create or replace function app_private.perform_admin_financial(sid uuid,expected_revision bigint,command text,body jsonb,reason text,source_id uuid,source_hash text) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions;r public.approval_requests;fresh_id uuid;eid uuid;candidate uuid;fresh_payload jsonb;admin_member uuid;
begin
 select * into s from public.sessions where id=sid;
 perform 1 from public.groups where id=s.group_id for no key update;
 select * into s from public.sessions where id=sid for update;
 if expected_revision is null or s.revision<>expected_revision or coalesce(length(trim(reason)),0) not between 1 and 500 or not app_private.admin_fallback_allowed(sid,command,body,source_id) then raise exception 'Chưa đủ điều kiện dự phòng, buổi đã đổi hoặc thiếu lý do';end if;
 if source_id is not null then
  select * into r from public.approval_requests where id=source_id and session_id=sid for update;
  if not found or r.payload_hash is distinct from source_hash or r.payload_hash<>encode(sha256(convert_to(r.payload::text,'UTF8')),'hex') then raise exception 'Yêu cầu làm căn cứ đã đổi';end if;
 end if;
 select id into admin_member from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active' and role='admin';
 insert into app_private.admin_execution_context values(txid_current(),auth.uid(),sid,command);
 case command
 when 'save_expense' then perform app_private.save_expense(sid,s.revision,body||jsonb_build_object('reason',reason));
 when 'add_expense' then
  perform app_private.add_expense(sid,s.revision,body->>'title_text',body->>'raw_amount',(body->>'payer')::uuid,array(select jsonb_array_elements_text(body->'beneficiaries'))::uuid[],body->>'mode',body->>'split',array(select jsonb_array_elements_text(body->'values_text')),reason);
 when 'apply_financial_change' then
  perform app_private.apply_financial_change(sid,s.revision,body->>'action_name',(body->'body')||jsonb_build_object('reason',reason));
 when 'finish_session' then perform app_private.finish_session(sid,s.revision,body->>'court');
 when 'payment_action' then perform app_private.payment_action((body->>'target')::uuid,'confirm');
 when 'assign_guest_collector' then
  candidate:=(body->>'member_id')::uuid;
  perform 1 from public.group_members where id=candidate for update;
  if not exists(select 1 from public.group_members m join public.guest_bank_accounts g on g.member_id=m.id where m.id=candidate and m.group_id=s.group_id and m.user_id is null and m.status='active') then raise exception 'Cần thành viên khách hoạt động đã có ngân hàng';end if;
  update public.sessions set collector_member_id=candidate,collector_nominee_member_id=null,revision=revision+1 where id=sid;
  update public.expenses set paid_by=candidate where session_id=sid and kind='court' and status='active';
  if s.status in('played','settled') then perform public.recalculate_session(sid,reason);end if;
 when 'apply_request' then
    if not exists(select 1 from public.group_members where group_id=s.group_id and user_id=r.requested_by and status='active') then raise exception 'Source requester is no longer active';end if;
if r.id is null or r.status not in('pending','expired') or r.expires_at>now() then raise exception 'Chỉ tạo yêu cầu mới từ căn cứ đã hết hạn';end if;
  update public.approval_requests set status='expired' where id=r.id and status='pending';
  update public.expenses set status='rejected' where approval_request_id=r.id and status='proposed';
  fresh_payload:=r.payload||jsonb_build_object('reason',reason,'source_request_id',r.id);
  if r.type='expense_proposal' then
   if(select count(*) from public.expenses where session_id=sid and status in('active','proposed'))>=200 then raise exception 'Expense limit reached';end if;
   insert into public.expenses(session_id,title,amount,paid_by,created_by,status,amount_mode,split_mode,unit_amount)
   values(sid,r.payload->>'title',(r.payload->>'amount')::bigint*case when r.payload->>'mode'='per_person' then jsonb_array_length(r.payload->'beneficiaries') else 1 end,(r.payload->>'payer')::uuid,r.requested_by,'proposed',r.payload->>'mode',r.payload->>'split',case when r.payload->>'mode'='per_person' then(r.payload->>'amount')::bigint else null end) returning id into eid;
   update public.expenses set note=left(coalesce(r.payload->>'note',''),2000),category_id=(select id from public.group_expense_categories where id=nullif(r.payload->>'category_id','')::uuid and group_id=s.group_id) where id=eid;
   fresh_payload:=fresh_payload||jsonb_build_object('expense_id',eid);
  elsif r.type='collector_nomination' then
   if not exists(select 1 from public.group_members where id=(r.payload->>'member_id')::uuid and group_id=s.group_id and status='active' and user_id is not null) then raise exception 'Nominee is no longer active';end if;
   fresh_payload:=fresh_payload||jsonb_build_object('phase','accept');end if;
  insert into public.approval_requests(group_id,session_id,type,payload,payload_hash,required_authority,requested_by,source,session_revision,expires_at)
  values(s.group_id,sid,r.type,fresh_payload,encode(sha256(convert_to(fresh_payload::text,'UTF8')),'hex'),case when r.type='collector_nomination' then fresh_payload->>'member_id' else admin_member::text end,r.requested_by,'app',s.revision,now()+interval '72 hours') returning id into fresh_id;
  if eid is not null then update public.expenses set approval_request_id=fresh_id where id=eid;end if;
  if r.type='collector_nomination' then update public.sessions set collector_nominee_member_id=(fresh_payload->>'member_id')::uuid where id=sid;
  else perform app_private.decide_session_request(fresh_id,true,encode(sha256(convert_to(fresh_payload::text,'UTF8')),'hex'));end if;
 else raise exception 'Thao tác dự phòng không hợp lệ';
 end case;
 delete from app_private.admin_execution_context where transaction_id=txid_current() and actor_id=auth.uid() and session_id=sid;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,sid,auth.uid(),'admin_fallback_applied',jsonb_build_object('reason',reason,'command',command,'source_request_id',source_id,'new_request_id',fresh_id));
 perform public.notify_group(s.group_id,'admin-fallback:'||gen_random_uuid(),'Admin đã thực hiện thao tác dự phòng với lý do công khai.','/sessions/'||sid);
end $$;
revoke all on function app_private.perform_admin_financial(uuid,bigint,text,jsonb,text,uuid,text) from public,anon,authenticated,service_role;


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
 perform public.recalculate_session(sid,reason);
end $$;


create or replace function public.notify_approval_change() returns trigger language plpgsql security definer set search_path='' as $$
declare destination text;message text;
begin
 if new.type='admin_fallback' then return new;end if;
 destination:=case when new.session_id is null then '/groups/'||new.group_id else '/approvals' end;
 if new.status='pending' and (tg_op='INSERT' or new.required_authority is distinct from old.required_authority or(new.payload_hash is distinct from old.payload_hash and new.created_at<>now())) then
 insert into public.notifications(group_id,user_id,event_key,title,href)
 select new.group_id,m.user_id,'request:'||new.id||':'||new.required_authority||':'||new.payload_hash,'Có yêu cầu mới đang chờ bạn duyệt',destination from public.group_members m where m.group_id=new.group_id and m.status='active' and m.user_id is not null and (m.id::text=new.required_authority or (new.required_authority='group_admin' and m.role='admin')) on conflict(user_id,event_key) do nothing;
 elsif tg_op='UPDATE' and new.status is distinct from old.status and new.status in ('approved','rejected','expired') then
 message:=case new.status when 'approved' then 'Yêu cầu của bạn đã được duyệt' when 'rejected' then 'Yêu cầu của bạn đã bị từ chối' else 'Yêu cầu của bạn đã hết hạn; không có thay đổi nào tự động được duyệt' end;
 insert into public.notifications(group_id,user_id,event_key,title,href) values(new.group_id,new.requested_by,'request-result:'||new.id,message,destination) on conflict(user_id,event_key) do nothing;
 end if;return new;
end $$;
