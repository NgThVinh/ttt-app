alter table public.sessions add column unlocked_until timestamptz;
create table app_private.admin_execution_context (
 transaction_id bigint not null, actor_id uuid not null, session_id uuid not null,
 command text not null, primary key(transaction_id,actor_id,session_id)
);
alter table app_private.admin_execution_context enable row level security;
revoke all on app_private.admin_execution_context from public,anon,authenticated,service_role;

create function app_private.admin_context(sid uuid,action_name text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from app_private.admin_execution_context c where c.transaction_id=txid_current() and c.actor_id=auth.uid() and c.session_id=sid and (c.command=action_name or(c.command='apply_request' and action_name in('decide_session_request','apply_financial_change'))))
$$;
revoke all on function app_private.admin_context(uuid,text) from public,anon,authenticated,service_role;
create function public.session_is_locked(sid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select s.status='settled' and s.settled_at<now()-interval '30 days' and (s.unlocked_until is null or s.unlocked_until<=now()) from public.sessions s where s.id=sid and public.is_member(s.group_id)),true)
$$;
revoke all on function public.session_is_locked(uuid) from public,anon;
grant execute on function public.session_is_locked(uuid) to authenticated;

create function public.unlock_session(sid uuid,expected_revision bigint,reason text) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_group_admin(s.group_id) then raise exception 'Chỉ admin nhóm được mở khóa';end if;
 if expected_revision is null or s.revision<>expected_revision or not public.session_is_locked(sid) or coalesce(length(trim(reason)),0) not between 1 and 500 then raise exception 'Cần đúng phiên bản, buổi đã khóa và lý do';end if;
 update public.sessions set unlocked_until=now()+interval '24 hours',revision=revision+1 where id=sid;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,sid,auth.uid(),'session_unlocked',jsonb_build_object('reason',trim(reason),'until',now()+interval '24 hours'));
 perform public.notify_group(s.group_id,'unlock:'||sid||':'||(s.revision+1),'Admin đã mở khóa buổi trong 24 giờ kèm lý do công khai.','/sessions/'||sid);
end $$;
revoke all on function public.unlock_session(uuid,bigint,text) from public,anon,service_role;
grant execute on function public.unlock_session(uuid,bigint,text) to authenticated;

create function app_private.admin_fallback_allowed(sid uuid,command text,body jsonb,source_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare s public.sessions;collector public.group_members;r public.approval_requests;p public.settlements;
begin
 select * into s from public.sessions where id=sid;
 if not found or not public.is_group_admin(s.group_id) or s.status='cancelled' or public.session_is_locked(sid) then return false;end if;
 select * into collector from public.group_members where id=s.collector_member_id;
 if command='payment_action' then
  select * into p from public.settlements where id=(body->>'target')::uuid and session_id=sid and status in('pending','marked_paid');
  if not found or body->>'operation' is distinct from 'confirm' or body->'statement_checked' is distinct from 'true'::jsonb then return false;end if;
  if exists(select 1 from public.group_members m where m.id=p.to_member and m.user_id is null) then return true;end if;
  if p.to_member=s.collector_member_id and p.status='marked_paid' and p.marked_paid_at<=now()-interval '72 hours' then return true;end if;
  return false;
 end if;
 if command='assign_guest_collector' then return s.collector_member_id is null or collector.user_id is null;end if;
 if s.collector_member_id is null or collector.user_id is null or collector.status<>'active' then return true;end if;
 select * into r from public.approval_requests where id=source_id and session_id=sid and type in('join','leave','weight','expense_proposal','collector_nomination') and required_authority=collector.id::text and status in('pending','expired') and created_at<=now()-interval '72 hours' and expires_at<=now();
 return found;
end $$;
revoke all on function app_private.admin_fallback_allowed(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;

create function app_private.perform_admin_financial(sid uuid,expected_revision bigint,command text,body jsonb,reason text,source_id uuid,source_hash text) returns void language plpgsql security definer set search_path='' as $$
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
  if r.id is null or r.status not in('pending','expired') or r.expires_at>now() then raise exception 'Chỉ tạo yêu cầu mới từ căn cứ đã hết hạn';end if;
  update public.approval_requests set status='expired' where id=r.id and status='pending';
  update public.expenses set status='rejected' where approval_request_id=r.id and status='proposed';
  fresh_payload:=r.payload||jsonb_build_object('reason',reason,'source_request_id',r.id);
  if r.type='expense_proposal' then
   insert into public.expenses(session_id,title,amount,paid_by,created_by,status,amount_mode,split_mode,unit_amount)
   values(sid,r.payload->>'title',(r.payload->>'amount')::bigint*case when r.payload->>'mode'='per_person' then jsonb_array_length(r.payload->'beneficiaries') else 1 end,(r.payload->>'payer')::uuid,r.requested_by,'proposed',r.payload->>'mode',r.payload->>'split',case when r.payload->>'mode'='per_person' then(r.payload->>'amount')::bigint else null end) returning id into eid;
   fresh_payload:=fresh_payload||jsonb_build_object('expense_id',eid);
  elsif r.type='collector_nomination' then fresh_payload:=fresh_payload||jsonb_build_object('phase','accept');end if;
  insert into public.approval_requests(group_id,session_id,type,payload,payload_hash,required_authority,requested_by,source,session_revision,expires_at)
  values(s.group_id,sid,r.type,fresh_payload,encode(sha256(convert_to(fresh_payload::text,'UTF8')),'hex'),case when r.type='collector_nomination' then fresh_payload->>'member_id' else admin_member::text end,r.requested_by,'app',s.revision,now()+interval '15 minutes') returning id into fresh_id;
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

create function public.preview_admin_financial(sid uuid,expected_revision bigint,command text,body jsonb,reason text,source_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.sessions;result jsonb;payload jsonb;draft uuid;fingerprint text;source_hash text;
begin
 select * into s from public.sessions where id=sid;
 perform 1 from public.groups where id=s.group_id for no key update;
 select * into s from public.sessions where id=sid for update;
 if not public.is_group_admin(s.group_id) or command is null or body is null or jsonb_typeof(body)<>'object' then raise exception 'Không có quyền';end if;
 if source_id is not null then select payload_hash into source_hash from public.approval_requests where id=source_id and session_id=sid;end if;
 begin
  perform app_private.perform_admin_financial(sid,expected_revision,command,body,trim(reason),source_id,source_hash);
  result:=public.session_details(sid);
  raise exception using errcode='PT004',message='admin preview rollback';
 exception when sqlstate 'PT004' then null;end;
 payload:=jsonb_build_object('command',command,'body',body,'reason',trim(reason),'source_id',source_id,'source_hash',source_hash);
 fingerprint:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 update public.approval_requests set status='cancelled' where session_id=sid and type='admin_fallback' and requested_by=auth.uid() and status='pending';
 if(select count(*) from public.approval_requests where requested_by=auth.uid() and type='admin_fallback' and created_at>now()-interval '24 hours')>=30 then raise exception 'Quá nhiều bản xem trước dự phòng';end if;
 insert into public.approval_requests(group_id,session_id,type,payload,payload_hash,required_authority,requested_by,session_revision,expires_at)
 values(s.group_id,sid,'admin_fallback',payload,fingerprint,(select id::text from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active'),auth.uid(),s.revision,now()+interval '15 minutes') returning id into draft;
 return jsonb_build_object('detail',result,'id',draft,'hash',fingerprint);
end $$;
create function public.apply_admin_financial(request_id uuid,expected_hash text) returns void language plpgsql security definer set search_path='' as $$
declare r public.approval_requests;
begin
 select * into r from public.approval_requests where id=request_id;
 perform 1 from public.groups where id=r.group_id for no key update;
 perform 1 from public.sessions where id=r.session_id for update;
 select * into r from public.approval_requests where id=request_id for update;
 if r.type is distinct from 'admin_fallback' or r.requested_by is distinct from auth.uid() or not public.is_group_admin(r.group_id) or r.payload_hash is distinct from expected_hash or r.payload_hash<>encode(sha256(convert_to(r.payload::text,'UTF8')),'hex') then raise exception 'Không có quyền hoặc bản xem trước đã đổi';end if;
 if r.status='approved' then return;end if;
 if r.status<>'pending' or r.expires_at<=now() then raise exception 'Bản xem trước đã hết hạn';end if;
 perform app_private.perform_admin_financial(r.session_id,r.session_revision,r.payload->>'command',r.payload->'body',r.payload->>'reason',(r.payload->>'source_id')::uuid,r.payload->>'source_hash');
 update public.approval_requests set status='approved',decided_by=auth.uid(),decided_at=now() where id=r.id;
end $$;
revoke all on function public.preview_admin_financial(uuid,bigint,text,jsonb,text,uuid),public.apply_admin_financial(uuid,text) from public,anon,service_role;
grant execute on function public.preview_admin_financial(uuid,bigint,text,jsonb,text,uuid),public.apply_admin_financial(uuid,text) to authenticated;

create or replace function app_private.apply_financial_change(sid uuid,expected_revision bigint,action_name text,body jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions;actor uuid;target uuid;op text;new_weight numeric;previous jsonb;eid uuid;why text;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 if actor is distinct from s.collector_member_id and not app_private.admin_context(sid,'apply_financial_change') then raise exception 'Chỉ người tính tiền được thay đổi phần tiền';end if;
 if s.revision<>expected_revision then raise exception 'Buổi đã thay đổi. Vui lòng xem trước lại';end if;
 if s.status not in ('played','settled') or (public.session_is_locked(s.id)) then raise exception 'Buổi chưa thể sửa hoặc đã khóa';end if;
 why:=trim(body->>'reason');if why is null or length(why) not between 1 and 500 then raise exception 'Cần lý do thay đổi';end if;
 if action_name='attendee' then
 target:=(body->>'member_id')::uuid;op:=body->>'operation';
 if op is null or op not in ('add','remove','weight') then raise exception 'Thao tác không hợp lệ';end if;
 if not exists(select 1 from public.group_members where id=target and group_id=s.group_id and (op<>'add' or status='active')) then raise exception 'Thành viên không hợp lệ';end if;
 select to_jsonb(a) into previous from public.session_attendees a where session_id=sid and member_id=target;
 if op='add' then
 if exists(select 1 from public.session_attendees where session_id=sid and member_id=target and rsvp='going' and removed_at is null) then raise exception 'Người này đã tham gia';end if;
 insert into public.session_attendees(session_id,member_id,rsvp,committed_at,commit_source) values(sid,target,'going',now(),'added_by_collector') on conflict(session_id,member_id) do update set rsvp='going',committed_at=now(),commit_source='added_by_collector',removed_at=null,removed_by=null,removal_reason=null;
 else
 if not exists(select 1 from public.session_attendees where session_id=sid and member_id=target and rsvp='going' and removed_at is null) then raise exception 'Người này chưa tham gia';end if;
 if op='remove' then
 if (select count(*) from public.session_attendees where session_id=sid and rsvp='going' and removed_at is null)<=1 then raise exception 'Buổi cần ít nhất một người tham gia';end if;
 if exists(select 1 from public.expense_split_inputs i join public.expenses e on e.id=i.expense_id where e.session_id=sid and e.status='active' and e.split_mode in ('exact','percent') and i.member_id=target) then raise exception 'Cần điều chỉnh hoặc xóa khoản chia chính xác/phần trăm trước khi rút người';end if;
 if exists(select 1 from public.expenses e where e.session_id=sid and e.status='active' and exists(select 1 from public.expense_split_inputs i where i.expense_id=e.id and i.member_id=target) and (select count(*) from public.expense_split_inputs i where i.expense_id=e.id)<=1) then raise exception 'Xóa khoản chỉ người này chịu trước khi rút người';end if;
 update public.session_attendees set removed_at=now(),removed_by=auth.uid(),removal_reason=why where session_id=sid and member_id=target;
 delete from public.expense_split_inputs i using public.expenses e where e.id=i.expense_id and e.session_id=sid and e.status='active' and i.member_id=target;
 else
 new_weight:=(body->>'weight')::numeric;if new_weight is null or new_weight<=0 or new_weight>100 or new_weight<>round(new_weight,6) then raise exception 'Hệ số cần lớn hơn 0, tối đa 100';end if;
 update public.session_attendees set weight=new_weight where session_id=sid and member_id=target;
 update public.expense_split_inputs i set weight=new_weight from public.expenses e where e.id=i.expense_id and e.session_id=sid and e.status='active' and e.split_mode='weighted' and i.member_id=target;
 end if;end if;
 -- Court follows current attendance. Explicit extra beneficiaries stay explicit.
 for eid in select id from public.expenses where session_id=sid and status='active' and kind='court' loop
 update public.expenses set split_mode='weighted' where id=eid;
 delete from public.expense_split_inputs where expense_id=eid;
 insert into public.expense_split_inputs(expense_id,member_id,weight) select eid,member_id,weight from public.session_attendees where session_id=sid and rsvp='going' and removed_at is null;
 end loop;
 insert into public.attendance_events(session_id,member_id,actor_id,action,before,after,reason,session_status_at_time) values(sid,target,auth.uid(),case when op='add' then 'added' when op='remove' then 'removed' else 'weight_changed' end,previous,(select to_jsonb(a) from public.session_attendees a where session_id=sid and member_id=target),why,s.status);
 elsif action_name='delete_expense' then
 eid:=(body->>'expense_id')::uuid;
 update public.expenses set status='deleted',deleted_at=now(),deleted_by=auth.uid(),deleted_reason=why where id=eid and session_id=sid and status='active';
 if not found then raise exception 'Khoản chi đã thay đổi';end if;
 else raise exception 'Thao tác không hợp lệ';end if;
 update public.expenses e set amount=e.unit_amount*(select count(*) from public.expense_split_inputs i where i.expense_id=e.id) where e.session_id=sid and e.status='active' and e.amount_mode='per_person';
 perform public.recalculate_session(sid,why);
end $$;

create or replace function app_private.add_expense(sid uuid,expected_revision bigint,title_text text,raw_amount text,payer uuid,beneficiaries uuid[],mode text,split text,values_text text[],reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions;actor uuid;eid uuid;rid uuid;body jsonb;total bigint;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 update public.expenses set status='rejected' where status='proposed' and session_id=sid and approval_request_id in(select id from public.approval_requests where session_id=sid and status='pending' and expires_at<=now());
 update public.approval_requests set status='expired' where session_id=sid and status='pending' and expires_at<=now();
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 if actor=s.collector_member_id or app_private.admin_context(sid,'add_expense') or (cardinality(beneficiaries)=1 and beneficiaries[1]=actor and exists(select 1 from public.session_attendees where session_id=sid and member_id=actor and rsvp='going' and removed_at is null)) then
 perform public.write_expense_internal(sid,expected_revision,title_text,raw_amount,payer,beneficiaries,mode,split,values_text,reason);return;
 end if;
 if not exists(select 1 from public.session_attendees where session_id=sid and member_id=actor and rsvp='going' and removed_at is null) then raise exception 'Chỉ người tham gia được đề xuất';end if;
 -- Validate with the same writer, then roll back the speculative financial changes.
 begin
 perform public.write_expense_internal(sid,expected_revision,title_text,raw_amount,payer,beneficiaries,mode,split,values_text,reason);
 raise exception using errcode='PT002',message='validation only';
 exception when sqlstate 'PT002' then null;end;
 total:=raw_amount::bigint*case when mode='per_person' then cardinality(beneficiaries) else 1 end;
 insert into public.expenses(session_id,title,amount,paid_by,created_by,amount_mode,split_mode,unit_amount,status)
 values(sid,title_text,total,payer,auth.uid(),mode,split,case when mode='per_person' then raw_amount::bigint else null end,'proposed') returning id into eid;
 body:=jsonb_build_object('expense_id',eid,'title',title_text,'amount',raw_amount,'payer',payer,'beneficiaries',beneficiaries,'mode',mode,'split',split,'values',values_text,'reason',reason);
 rid:=public.new_session_request(sid,'expense_proposal',body,s.collector_member_id::text);
 update public.expenses set approval_request_id=rid where id=eid;
end $$;


create or replace function app_private.finish_session(sid uuid,expected_revision bigint,court text) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions; actor uuid; eid uuid; total bigint;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 if (actor is distinct from s.collector_member_id and not app_private.admin_context(sid,'finish_session')) or s.status<>'planned' or now()<s.starts_at or now()<s.commit_deadline or s.revision<>expected_revision then raise exception 'Chưa thể hoàn tất buổi';end if;
 if s.collector_member_id is null then raise exception 'Cần có người tính tiền trước';end if;
 if app_private.admin_context(sid,'finish_session') then actor:=s.collector_member_id;end if;
 update public.session_attendees set rsvp='not_going',commit_source='auto_not_going' where session_id=sid and committed_at is null;
 if not exists(select 1 from public.session_attendees where session_id=sid and rsvp='going' and committed_at is not null and removed_at is null) then raise exception 'Chưa có người chốt tham gia';end if;
 total:=court::bigint;if total<0 or total>1000000000000 then raise exception 'Tiền sân không hợp lệ';end if;
 select id into eid from public.expenses where session_id=sid and kind='court' and status='active';
 if eid is null then insert into public.expenses(session_id,title,kind,amount,paid_by,created_by,split_mode) values(sid,'Tiền sân','court',total,actor,auth.uid(),'weighted') returning id into eid;
 else update public.expenses set amount=total where id=eid;end if;
 delete from public.expense_split_inputs where expense_id=eid;
 insert into public.expense_split_inputs(expense_id,member_id,weight) select eid,member_id,weight from public.session_attendees where session_id=sid and rsvp='going' and committed_at is not null and removed_at is null;
 update public.sessions set status='played' where id=sid;
 perform public.recalculate_session(sid,'Hoàn tất buổi chơi');
end $$;

create or replace function app_private.payment_action(target uuid,operation text) returns void language plpgsql security definer set search_path='' as $$
declare pay public.settlements;s public.sessions;actor uuid;
begin
 select session.* into s from public.sessions session join public.settlements p on p.session_id=session.id where p.id=target for update of session;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 select * into pay from public.settlements where id=target for update;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 if (operation='mark' and actor=pay.from_member and pay.status='marked_paid') or (operation='confirm' and (actor=pay.to_member or app_private.admin_context(s.id,'payment_action')) and pay.status='confirmed') then return;end if;
 if operation='mark' and actor=pay.from_member and pay.status='pending' then update public.settlements set status='marked_paid',marked_paid_at=now() where id=target;
 elsif operation='confirm' and (actor=pay.to_member or app_private.admin_context(s.id,'payment_action')) and pay.status in ('pending','marked_paid') then update public.settlements set status='confirmed',confirmed_at=now() where id=target;
 else raise exception 'Thao tác không được phép hoặc khoản đã thay đổi';end if;
 update public.sessions set revision=revision+1 where id=s.id;
 if not exists(select 1 from public.settlements where session_id=s.id and status in ('pending','marked_paid')) then update public.sessions set status='settled',settled_at=now() where id=s.id;end if;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,s.id,auth.uid(),operation,jsonb_build_object('settlement_id',target));
end $$;

create or replace function app_private.decide_session_request(request_id uuid,approve boolean,expected_hash text) returns void language plpgsql security definer set search_path='' as $$
declare r public.approval_requests;s public.sessions;actor uuid;candidate uuid;target uuid;op text;eid uuid;
begin
 select * into r from public.approval_requests where id=request_id;
 if r.session_id is null then raise exception 'Yêu cầu không hợp lệ';end if;
 select * into s from public.sessions where id=r.session_id for update;
 select * into r from public.approval_requests where id=request_id for update;
 if not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 if r.status<>'pending' or r.expires_at<=now() or r.payload_hash<>expected_hash or r.payload_hash<>encode(sha256(convert_to(r.payload::text,'UTF8')),'hex') then raise exception 'Yêu cầu đã thay đổi hoặc hết hạn';end if;
 if not app_private.admin_context(s.id,'decide_session_request') and (actor::text is distinct from r.required_authority or (r.type<>'collector_nomination' and actor is distinct from s.collector_member_id)) then raise exception 'Bạn không phải người có thẩm quyền';end if;
 if approve is null then raise exception 'Quyết định không hợp lệ';end if;
 if approve then
 if r.session_revision<>s.revision or s.status='cancelled' or (public.session_is_locked(s.id)) then raise exception 'Buổi đã thay đổi hoặc đã khóa. Cần gửi yêu cầu mới';end if;
 if r.type='expense_proposal' then
 eid:=(r.payload->>'expense_id')::uuid;
 perform public.write_expense_internal(s.id,s.revision,r.payload->>'title',r.payload->>'amount',(r.payload->>'payer')::uuid,array(select jsonb_array_elements_text(r.payload->'beneficiaries')::uuid),r.payload->>'mode',r.payload->>'split',array(select jsonb_array_elements_text(r.payload->'values')),r.payload->>'reason',eid);
 elsif r.type in ('join','leave','weight') then
 target:=(r.payload->>'member_id')::uuid;
 if not exists(select 1 from public.group_members where id=target and group_id=s.group_id and user_id=r.requested_by and status='active') then raise exception 'Người yêu cầu đã thay đổi';end if;
 op:=case when r.type='join' then 'add' when r.type='leave' then 'remove' else 'weight' end;
 if s.status='planned' then
 if op='add' then insert into public.session_attendees(session_id,member_id,rsvp,committed_at,commit_source) values(s.id,target,'going',now(),'added_by_collector') on conflict(session_id,member_id) do update set rsvp='going',committed_at=now(),removed_at=null,commit_source='added_by_collector';
 elsif op='remove' then update public.session_attendees set removed_at=now(),removed_by=auth.uid(),removal_reason=r.payload->>'reason' where session_id=s.id and member_id=target;
 else update public.session_attendees set weight=(r.payload->>'weight')::numeric where session_id=s.id and member_id=target;end if;
 insert into public.attendance_events(session_id,member_id,actor_id,action,reason,session_status_at_time) values(s.id,target,auth.uid(),r.type||'_approved',r.payload->>'reason',s.status);
 update public.sessions set revision=revision+1 where id=s.id;
 else perform app_private.apply_financial_change(s.id,s.revision,'attendee',r.payload||jsonb_build_object('operation',op));end if;
 elsif r.type='collector_nomination' then
 candidate:=(r.payload->>'member_id')::uuid;
 if r.payload->>'phase'='consent' then
 if actor is distinct from s.collector_member_id then raise exception 'Người tính tiền đã thay đổi';end if;
 update public.approval_requests set payload=payload||'{"phase":"accept"}',required_authority=candidate::text where id=r.id;
 update public.approval_requests set payload_hash=encode(sha256(convert_to(payload::text,'UTF8')),'hex') where id=r.id;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,s.id,auth.uid(),'collector_transfer_consented',jsonb_build_object('request_id',r.id));return;
 end if;
 if actor<>candidate or not exists(select 1 from public.group_members m join public.profiles p on p.id=m.user_id where m.id=candidate and m.group_id=s.group_id and m.status='active' and coalesce(p.bank_bin,'')<>'' and coalesce(p.bank_account_no,'')<>'') then raise exception 'Người nhận vai trò cần tài khoản và thông tin ngân hàng';end if;
 update public.sessions set collector_member_id=candidate,collector_nominee_member_id=null where id=s.id;
 update public.expenses set paid_by=candidate where session_id=s.id and kind='court' and status='active';
 if s.status in ('played','settled') then perform public.recalculate_session(s.id,r.payload->>'reason');else update public.sessions set revision=revision+1 where id=s.id;end if;
 else raise exception 'Loại yêu cầu chưa được hỗ trợ';end if;
 else
 if r.type='expense_proposal' then update public.expenses set status='rejected' where id=(r.payload->>'expense_id')::uuid and status='proposed';end if;
 if r.type='collector_nomination' then update public.sessions set collector_nominee_member_id=null where id=s.id and collector_nominee_member_id=(r.payload->>'member_id')::uuid;end if;
 end if;
 update public.approval_requests set status=case when approve then 'approved' else 'rejected' end,decided_by=auth.uid(),decided_at=now() where id=r.id;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,s.id,auth.uid(),case when approve then 'approval_approved' else 'approval_rejected' end,jsonb_build_object('request_id',r.id,'type',r.type,'requested_by',r.requested_by,'reason',r.payload->>'reason'));
end $$;



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
 if not exists(select 1 from public.session_attendees where session_id=sid and member_id=payer and rsvp='going' and removed_at is null) or exists(select 1 from unnest(beneficiaries) x where not exists(select 1 from public.session_attendees where session_id=sid and member_id=x and rsvp='going' and removed_at is null)) then raise exception 'Người ứng và người chịu phải tham gia buổi';end if;
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

create or replace function public.request_session_change(sid uuid,kind text,body jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.sessions;actor uuid;canonical jsonb;candidate uuid;authority uuid;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 if kind is null or kind not in ('join','leave','weight','collector_nomination') or length(trim(coalesce(body->>'reason',''))) not between 1 and 500 then raise exception 'Yêu cầu không hợp lệ';end if;
 if s.status='cancelled' or (public.session_is_locked(s.id)) then raise exception 'Buổi đã khóa';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 authority:=s.collector_member_id;
 if kind='collector_nomination' then
 if s.created_by<>auth.uid() and actor is distinct from s.collector_member_id then raise exception 'Chỉ người tạo hoặc người tính tiền được đề cử';end if;
 candidate:=(body->>'member_id')::uuid;
 if not exists(select 1 from public.group_members where id=candidate and group_id=s.group_id and status='active' and user_id is not null) or candidate=s.collector_member_id then raise exception 'Người được đề cử không hợp lệ';end if;
 canonical:=jsonb_build_object('member_id',candidate,'reason',trim(body->>'reason'),'phase',case when s.collector_member_id is not null and actor<>s.collector_member_id then 'consent' else 'accept' end);
 if canonical->>'phase'='accept' then authority:=candidate;end if;
 if exists(select 1 from public.approval_requests where session_id=sid and type='collector_nomination' and status='pending' and expires_at>now()) then raise exception 'Đang có đề cử chờ xử lý';end if;
 update public.sessions set collector_nominee_member_id=candidate where id=sid;
 else
 if authority is null then raise exception 'Cần có người tính tiền trước';end if;
 if kind in ('join','leave') and now()<s.commit_deadline then raise exception 'Trước hạn, hãy tự chốt đi hoặc không đi';end if;
 if kind in ('leave','weight') and not exists(select 1 from public.session_attendees where session_id=sid and member_id=actor and rsvp='going' and removed_at is null) then raise exception 'Bạn chưa tham gia';end if;
 if kind='join' and exists(select 1 from public.session_attendees where session_id=sid and member_id=actor and rsvp='going' and removed_at is null) then raise exception 'Bạn đã tham gia';end if;
 canonical:=jsonb_build_object('member_id',actor,'reason',trim(body->>'reason'));
 if kind='weight' then
 if (body->>'weight')::numeric<=0 or (body->>'weight')::numeric>100 or (body->>'weight')::numeric<>round((body->>'weight')::numeric,6) or body->>'weight' is null then raise exception 'Hệ số không hợp lệ';end if;
 canonical:=canonical||jsonb_build_object('weight',body->>'weight');end if;
 end if;
 return public.new_session_request(sid,kind,canonical,authority::text);
end $$;


create or replace function public.manage_session(sid uuid, expected_revision bigint, operation_name text, body jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
 s public.sessions;
 actor uuid;
 title_text text;
 venue_text text;
 note_text text;
 why text;
 start_time timestamptz;
 deadline timestamptz;
 schedule_changed boolean := false;
 reset_choices boolean := false;
 event_name text;
 previous jsonb;
 current_data jsonb;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền quản lý buổi'; end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 if s.created_by is distinct from auth.uid() and actor is distinct from s.collector_member_id and not public.is_group_admin(s.group_id) then
  raise exception 'Chỉ người tạo, người tính tiền hoặc admin được quản lý lịch';
 end if;
 if expected_revision is null or s.revision<>expected_revision then raise exception 'Buổi đã thay đổi. Vui lòng tải lại'; end if;
 if public.session_is_locked(s.id) then raise exception 'Buổi đã khóa'; end if;
 if operation_name is null or operation_name not in ('edit','cancel','reopen') or body is null or jsonb_typeof(body)<>'object' then raise exception 'Thao tác không hợp lệ'; end if;
 why:=trim(body->>'reason');
 if jsonb_typeof(body->'reason') is distinct from 'string' or coalesce(length(why),0) not between 1 and 500 then raise exception 'Cần lý do thay đổi'; end if;
 if exists(select 1 from jsonb_object_keys(body) k where k not in ('title','venue','note','starts_at','commit_deadline','reason')) then raise exception 'Chỉ được sửa thông tin lịch'; end if;
 previous:=jsonb_build_object('title',s.title,'venue',s.venue,'note',s.note,'starts_at',s.starts_at,'commit_deadline',s.commit_deadline,'status',s.status);

 if operation_name in ('edit','reopen') then
  if jsonb_typeof(body->'title') is distinct from 'string' or jsonb_typeof(body->'venue') is distinct from 'string'
   or jsonb_typeof(body->'starts_at') is distinct from 'string' or jsonb_typeof(body->'commit_deadline') is distinct from 'string'
   or (body ? 'note' and jsonb_typeof(body->'note') not in ('string','null')) then raise exception 'Thông tin lịch không hợp lệ'; end if;
  title_text:=trim(body->>'title'); venue_text:=trim(body->>'venue'); note_text:=nullif(trim(body->>'note'),'');
  start_time:=(body->>'starts_at')::timestamptz; deadline:=(body->>'commit_deadline')::timestamptz;
  if length(title_text) not between 1 and 160 or length(venue_text) not between 1 and 200 or coalesce(length(note_text),0)>2000
   or not isfinite(start_time) or not isfinite(deadline) or deadline>start_time then raise exception 'Thông tin lịch không hợp lệ'; end if;
  schedule_changed:=start_time is distinct from s.starts_at or deadline is distinct from s.commit_deadline;
 end if;

 if operation_name='edit' then
  if s.status='cancelled' then raise exception 'Mở lại buổi trước khi sửa thông tin'; end if;
  if schedule_changed and (s.status<>'planned' or s.commit_deadline<=now() or deadline<=now()) then
   raise exception 'Chỉ được đổi giờ hoặc hạn chốt khi chưa đến hạn chốt';
  end if;
  if previous=jsonb_build_object('title',title_text,'venue',venue_text,'note',note_text,'starts_at',start_time,'commit_deadline',deadline,'status',s.status) then return; end if;
  reset_choices:=schedule_changed;
  event_name:='session_metadata_updated';
 elsif operation_name='cancel' then
  if s.status='cancelled' then raise exception 'Buổi đã hủy'; end if;
  if body - 'reason'<>'{}'::jsonb then raise exception 'Hủy buổi chỉ cần lý do'; end if;
  event_name:='session_cancelled';
 else
  if s.status<>'cancelled' or deadline<=now() then raise exception 'Mở lại cần buổi đã hủy và hạn chốt trong tương lai'; end if;
  reset_choices:=true;
  event_name:='session_reopened';
 end if;

 -- Even rejected/deleted expenses and cancelled transfers are financial history.
 -- An administrative calendar action must never erase or bypass that history.
 if operation_name in ('cancel','reopen') and (
  exists(select 1 from public.expenses where session_id=sid and amount<>0)
  or exists(select 1 from public.settlements where session_id=sid)
  or exists(select 1 from public.expense_allocations a join public.expenses e on e.id=a.expense_id where e.session_id=sid and a.share_amount<>0)
 ) then raise exception 'Buổi đã có số tiền. Cần người tính tiền xử lý các khoản thay vì hủy'; end if;

 if reset_choices then
  insert into public.attendance_events(session_id,member_id,actor_id,action,before,after,reason,session_status_at_time)
   select sid,a.member_id,auth.uid(),'rsvp_reset',jsonb_build_object('rsvp',a.rsvp,'committed_at',a.committed_at,'commit_source',a.commit_source),
    jsonb_build_object('rsvp','none','committed_at',null,'commit_source',null),why,s.status
   from public.session_attendees a where a.session_id=sid and a.removed_at is null and (a.rsvp<>'none' or a.committed_at is not null);
  update public.session_attendees set rsvp='none',committed_at=null,commit_source=null where session_id=sid and removed_at is null;
 end if;
 if operation_name='cancel' then
  update public.expenses set status='rejected' where session_id=sid and status='proposed';
  update public.approval_requests set status='cancelled',decided_by=auth.uid(),decided_at=now(),decision_note=why where session_id=sid and status='pending';
  update public.sessions set status='cancelled',collector_nominee_member_id=null,revision=revision+1 where id=sid;
 else
  update public.sessions set title=title_text,venue=venue_text,note=note_text,starts_at=start_time,commit_deadline=deadline,
   status=case when operation_name='reopen' then 'planned' else status end,
   settled_at=case when operation_name='reopen' then null else settled_at end,
   schedule_generation=schedule_generation+case when reset_choices then 1 else 0 end,revision=revision+1 where id=sid;
 end if;
 select jsonb_build_object('title',title,'venue',venue,'note',note,'starts_at',starts_at,'commit_deadline',commit_deadline,'status',status) into current_data from public.sessions where id=sid;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,sid,auth.uid(),event_name,jsonb_build_object('reason',why,'before',previous,'after',current_data,'rsvp_reset',reset_choices));
 perform public.notify_group(s.group_id,'session-calendar:'||sid||':'||(s.revision+1),
  case when operation_name='cancel' then 'Buổi đã hủy: ' when operation_name='reopen' then 'Buổi mở lại; hãy tự chốt tham gia: ' when reset_choices then 'Lịch đã đổi; hãy tự chốt tham gia lại: ' else 'Thông tin buổi đã cập nhật: ' end || s.title,'/sessions/'||sid);
end $$;

create or replace function public.set_guest_bank(target uuid,bank_bin_text text,account_text text,name_text text,reason text) returns void language plpgsql security definer set search_path='' as $$
declare m public.group_members; next_revision bigint;
begin
 select * into m from public.group_members where id=target;
 if not found or not public.is_group_admin(m.group_id) then raise exception 'Chỉ admin nhóm được nhập ngân hàng cho thành viên khách';end if;
 perform 1 from public.groups where id=m.group_id for no key update;
 select * into m from public.group_members where id=target for update;
 if m.user_id is not null or m.status<>'active' then raise exception 'Thành viên đã có tài khoản cần tự quản lý ngân hàng';end if;
 if bank_bin_text is null or bank_bin_text !~ '^[0-9]{6}$' or account_text is null or account_text !~ '^[A-Za-z0-9]{4,30}$' or coalesce(length(trim(name_text)),0) not between 1 and 100 or coalesce(length(trim(reason)),0) not between 1 and 500 then raise exception 'Cần đủ thông tin ngân hàng và lý do';end if;
 insert into public.guest_bank_accounts(member_id,group_id,bank_bin,bank_account_no,bank_account_name) values(target,m.group_id,bank_bin_text,account_text,trim(name_text)) on conflict(member_id) do update set bank_bin=excluded.bank_bin,bank_account_no=excluded.bank_account_no,bank_account_name=excluded.bank_account_name,revision=public.guest_bank_accounts.revision+1,updated_at=now() returning revision into next_revision;
 insert into public.audit_log(group_id,actor_id,action,payload) values(m.group_id,auth.uid(),'guest_bank_updated',jsonb_build_object('member_id',target,'reason',trim(reason),'revision',next_revision::text));
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) select m.group_id,s.id,auth.uid(),'guest_bank_updated',jsonb_build_object('member_id',target,'reason',trim(reason)) from public.sessions s where s.group_id=m.group_id and (s.collector_member_id=target or exists(select 1 from public.settlements p where p.session_id=s.id and p.to_member=target));
 perform public.notify_group(m.group_id,'guest-bank:'||target||':'||next_revision,'Admin đã cập nhật ngân hàng thành viên chưa có tài khoản; hãy kiểm tra thông tin trước khi chuyển.','/groups/'||m.group_id);
end $$;

create or replace function public.reserve_expense_receipt(target uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.expenses;s public.sessions;rid uuid:=gen_random_uuid();
begin
 select session.* into s from public.sessions session join public.expenses ex on ex.session_id=session.id where ex.id=target for update of session;
 select * into e from public.expenses where id=target;
 if not public.is_member(s.group_id) or e.status not in ('active','proposed') or (e.created_by is distinct from auth.uid() and not exists(select 1 from public.group_members where id=s.collector_member_id and user_id=auth.uid())) or (public.session_is_locked(s.id)) then raise exception 'Không có quyền thêm hóa đơn';end if;
 if (select count(*) from public.expense_receipts where expense_id=target)>=20 then raise exception 'Tối đa 20 ảnh hóa đơn';end if;
 insert into public.expense_receipts(id,expense_id,group_id,uploaded_by,storage_path) values(rid,target,s.group_id,auth.uid(),s.group_id||'/'||rid||'.jpg');return rid;
end $$;

create or replace function public.can_upload_receipt_file(bucket text,path text) returns boolean language sql stable security definer set search_path='' as $$
 select case when bucket='3t-payment-evidence' then exists(select 1 from public.payment_evidence e join public.settlements p on p.id=e.settlement_id join public.group_members m on m.id=p.from_member where e.storage_path=path and e.uploaded_by=auth.uid() and m.user_id=auth.uid() and m.status='active' and public.is_member(e.group_id) and e.status='reserved' and e.created_at>now()-interval '15 minutes' and p.status in ('pending','marked_paid','confirmed') and (p.confirmed_at is null or p.confirmed_at>now()-interval '30 days'))
 when bucket='3t-expense-receipts' then exists(select 1 from public.expense_receipts r join public.expenses e on e.id=r.expense_id join public.sessions s on s.id=e.session_id where r.storage_path=path and r.uploaded_by=auth.uid() and public.is_member(r.group_id) and r.status='reserved' and r.created_at>now()-interval '15 minutes' and e.status in ('active','proposed') and (e.created_by=auth.uid() or exists(select 1 from public.group_members where id=s.collector_member_id and user_id=auth.uid())) and not(public.session_is_locked(s.id))) else false end
$$;

create or replace function app_private.claim_collector(sid uuid,expected_revision bigint,court text) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions;actor uuid;total bigint;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) or s.collector_member_id is not null or s.status='cancelled' or public.session_is_locked(sid) or s.revision<>expected_revision then raise exception 'Không thể nhận vai trò. Buổi có thể đã thay đổi';end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and coalesce(bank_account_no,'')<>'' and coalesce(bank_bin,'')<>'' and coalesce(bank_account_name,'')<>'') then raise exception 'Cần lưu thông tin ngân hàng trước';end if;
 total:=court::bigint;if total<0 or total>1000000000000 then raise exception 'Tiền sân không hợp lệ';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 update public.sessions set collector_member_id=actor,revision=revision+1 where id=sid;
 insert into public.expenses(session_id,title,kind,amount,paid_by,created_by) values(sid,'Tiền sân','court',total,actor,auth.uid());
 insert into public.audit_log(group_id,session_id,actor_id,action) values(s.group_id,sid,auth.uid(),'collector_claimed');
end $$;

create or replace function public.session_details(sid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin result:=public.session_details_before_calendar(sid);return result||jsonb_build_object('calendar_locked',public.session_is_locked(sid));end $$;
revoke all on function public.session_details(uuid) from public,anon;
grant execute on function public.session_details(uuid) to authenticated;

create or replace function public.notify_approval_change() returns trigger language plpgsql security definer set search_path='' as $$
declare destination text;message text;
begin
 if new.type='admin_fallback' then return new;end if;
 destination:=case when new.session_id is null then '/groups/'||new.group_id else '/approvals' end;
 if new.status='pending' and (tg_op='INSERT' or new.required_authority is distinct from old.required_authority) then
 insert into public.notifications(group_id,user_id,event_key,title,href)
 select new.group_id,m.user_id,'request:'||new.id||':'||new.required_authority,'Có yêu cầu mới đang chờ bạn duyệt',destination from public.group_members m where m.group_id=new.group_id and m.status='active' and m.user_id is not null and (m.id::text=new.required_authority or (new.required_authority='group_admin' and m.role='admin')) on conflict(user_id,event_key) do nothing;
 elsif tg_op='UPDATE' and new.status is distinct from old.status and new.status in ('approved','rejected','expired') then
 message:=case new.status when 'approved' then 'Yêu cầu của bạn đã được duyệt' when 'rejected' then 'Yêu cầu của bạn đã bị từ chối' else 'Yêu cầu của bạn đã hết hạn; không có thay đổi nào tự động được duyệt' end;
 insert into public.notifications(group_id,user_id,event_key,title,href) values(new.group_id,new.requested_by,'request-result:'||new.id,message,destination) on conflict(user_id,event_key) do nothing;
 end if;return new;
end $$;
