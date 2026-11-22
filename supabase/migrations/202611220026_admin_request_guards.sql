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

