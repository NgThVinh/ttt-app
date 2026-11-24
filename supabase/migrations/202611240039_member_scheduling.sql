-- New booking rules: membership grants equal scheduling rights; financial writes
-- belong exclusively to the accepted collector, including administrative paths.
alter table public.sessions add column ends_at timestamptz,
 add column costs_finalized_at timestamptz;
alter table public.sessions add constraint session_end_after_start check(ends_at is null or ends_at>starts_at);

create function app_private.assert_collector(sid uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) or not exists(select 1 from public.group_members where id=s.collector_member_id and group_id=s.group_id and user_id=auth.uid() and status='active') then raise exception 'Chỉ người tính tiền được đặt chi phí và hóa đơn';end if;
end $$;

-- Guard the shared entry points so legacy UI, AI, direct RPC calls and admin
-- fallback all use the same collector-only rule. Keep existing validation/math.
alter function app_private.perform_admin_financial(uuid,bigint,text,jsonb,text,uuid,text) rename to perform_admin_before_member_rules;
create function app_private.perform_admin_financial(sid uuid,expected_revision bigint,command text,body jsonb,reason text,source_id uuid,source_hash text) returns void language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 if command in ('add_expense','save_expense','apply_financial_change','finish_session') then perform app_private.assert_collector(sid);end if;
 if command='assign_guest_collector' then raise exception 'Người được đề cử phải có tài khoản và tự xác nhận';end if;
 if command='apply_request' then
  select type into kind from public.approval_requests where id=source_id and session_id=sid;
  if kind='expense_proposal' then perform app_private.assert_collector(sid);end if;
 end if;
 perform app_private.perform_admin_before_member_rules(sid,expected_revision,command,body,reason,source_id,source_hash);
end $$;
revoke all on function app_private.perform_admin_financial(uuid,bigint,text,jsonb,text,uuid,text) from public,anon,authenticated,service_role;

alter function app_private.save_expense(uuid,bigint,jsonb) rename to save_expense_before_member_rules;
create function app_private.save_expense(sid uuid,expected_revision bigint,body jsonb) returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform app_private.assert_collector(sid);
 return app_private.save_expense_before_member_rules(sid,expected_revision,body);
end $$;
revoke all on function app_private.save_expense(uuid,bigint,jsonb) from public,anon,authenticated,service_role;

alter function app_private.add_expense(uuid,bigint,text,text,uuid,uuid[],text,text,text[],text) rename to add_expense_before_member_rules;
create function app_private.add_expense(sid uuid,expected_revision bigint,title_text text,raw_amount text,payer uuid,beneficiaries uuid[],mode text,split text,values_text text[],reason text default '') returns void language plpgsql security definer set search_path='' as $$
begin
 perform app_private.assert_collector(sid);
 perform app_private.add_expense_before_member_rules(sid,expected_revision,title_text,raw_amount,payer,beneficiaries,mode,split,values_text,reason);
end $$;
revoke all on function app_private.add_expense(uuid,bigint,text,text,uuid,uuid[],text,text,text[],text) from public,anon,authenticated,service_role;

alter function public.write_expense_internal(uuid,bigint,text,text,uuid,uuid[],text,text,text[],text,uuid) rename to write_expense_before_member_rules;
create function public.write_expense_internal(sid uuid,expected_revision bigint,title_text text,raw_amount text,payer uuid,beneficiaries uuid[],mode text,split text,values_text text[],reason text default '',activate_id uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin
 perform app_private.assert_collector(sid);
 perform public.write_expense_before_member_rules(sid,expected_revision,title_text,raw_amount,payer,beneficiaries,mode,split,values_text,reason,activate_id);
end $$;
revoke all on function public.write_expense_internal(uuid,bigint,text,text,uuid,uuid[],text,text,text[],text,uuid) from public,anon,authenticated,service_role;

alter function app_private.apply_financial_change(uuid,bigint,text,jsonb) rename to apply_change_before_member_rules;
create function app_private.apply_financial_change(sid uuid,expected_revision bigint,action_name text,body jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 perform app_private.assert_collector(sid);
 if action_name='attendee' and exists(select 1 from public.sessions where id=sid and status<>'planned') then raise exception 'Buổi đã chốt chi phí; danh sách tham gia đã khóa';end if;
 perform app_private.apply_change_before_member_rules(sid,expected_revision,action_name,body);
end $$;
revoke all on function app_private.apply_financial_change(uuid,bigint,text,jsonb) from public,anon,authenticated,service_role;

alter function app_private.decide_session_request(uuid,boolean,text) rename to decide_request_before_member_rules;
create function app_private.decide_session_request(request_id uuid,approve boolean,expected_hash text) returns void language plpgsql security definer set search_path='' as $$
declare r public.approval_requests;s public.sessions;
begin
 select * into r from public.approval_requests where id=request_id;
 select * into s from public.sessions where id=r.session_id for update;
 if r.type='collector_nomination' then
  if s.status<>'planned' then raise exception 'Buổi đã chốt chi phí; không thể đổi vai trò';end if;
  -- Even an administrative fallback cannot accept on the nominee's behalf.
  if r.payload->>'phase'='accept' and not exists(select 1 from public.group_members where id=(r.payload->>'member_id')::uuid and user_id=auth.uid() and status='active') then raise exception 'Người được đề cử phải tự xác nhận';end if;
 end if;
 if approve and r.type in ('join','leave','weight') and s.status<>'planned' then raise exception 'Buổi đã chốt chi phí; danh sách tham gia đã khóa';end if;
 if approve and r.type='expense_proposal' then perform app_private.assert_collector(s.id);end if;
 perform app_private.decide_request_before_member_rules(request_id,approve,expected_hash);
end $$;
revoke all on function app_private.decide_session_request(uuid,boolean,text) from public,anon,authenticated,service_role;

alter function public.expense_editor_data(uuid) rename to expense_editor_before_member_rules;
revoke all on function public.expense_editor_before_member_rules(uuid) from public,anon,authenticated,service_role;
create function public.expense_editor_data(sid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;can_edit boolean;
begin
 rows:=public.expense_editor_before_member_rules(sid);
 select exists(select 1 from public.sessions s join public.group_members m on m.id=s.collector_member_id where s.id=sid and m.user_id=auth.uid() and m.status='active') and not public.session_is_locked(sid) into can_edit;
 return(select coalesce(jsonb_agg(x||jsonb_build_object('can_edit',can_edit)),'[]') from jsonb_array_elements(rows) x);
end $$;
revoke all on function public.expense_editor_data(uuid) from public,anon,service_role;
grant execute on function public.expense_editor_data(uuid) to authenticated;

alter function public.reserve_expense_receipt(uuid) rename to reserve_receipt_before_member_rules;
revoke all on function public.reserve_receipt_before_member_rules(uuid) from public,anon,authenticated,service_role;
create function public.reserve_expense_receipt(target uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 select session_id into sid from public.expenses where id=target;
 perform app_private.assert_collector(sid);
 return public.reserve_receipt_before_member_rules(target);
end $$;
revoke all on function public.reserve_expense_receipt(uuid) from public,anon,service_role;
grant execute on function public.reserve_expense_receipt(uuid) to authenticated;

create or replace function public.can_upload_receipt_file(bucket text,path text) returns boolean language sql stable security definer set search_path='' as $$
 select case when bucket='3t-payment-evidence' then exists(select 1 from public.payment_evidence e join public.settlements p on p.id=e.settlement_id join public.group_members m on m.id=p.from_member where e.storage_path=path and e.uploaded_by=auth.uid() and m.user_id=auth.uid() and m.status='active' and public.is_member(e.group_id) and e.status='reserved' and e.created_at>now()-interval '15 minutes' and p.status in ('pending','marked_paid','confirmed') and (p.confirmed_at is null or p.confirmed_at>now()-interval '30 days'))
 when bucket='3t-expense-receipts' then exists(select 1 from public.expense_receipts r join public.expenses e on e.id=r.expense_id join public.sessions s on s.id=e.session_id join public.group_members m on m.id=s.collector_member_id where r.storage_path=path and r.uploaded_by=auth.uid() and public.is_member(r.group_id) and r.status='reserved' and r.created_at>now()-interval '15 minutes' and e.status in ('active','proposed') and m.user_id=auth.uid() and m.status='active' and not public.session_is_locked(s.id)) else false end
$$;
revoke all on function public.can_upload_receipt_file(text,text) from public,anon,service_role;
grant execute on function public.can_upload_receipt_file(text,text) to authenticated;

create or replace function public.create_invite(g uuid,hashed_token text,valid_until timestamptz,use_limit integer) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform 1 from public.groups where id=g for update;
 if not public.is_member(g) then raise exception 'Chỉ thành viên nhóm được tạo link mời';end if;
 if valid_until is null or valid_until<=now() or valid_until>now()+interval '30 days' or use_limit is null or use_limit not between 1 and 100 or hashed_token is null or hashed_token !~ '^[a-f0-9]{64}$' then raise exception 'Giới hạn link mời không hợp lệ';end if;
 if(select count(*) from public.invites where group_id=g and created_at>now()-interval '1 hour')>=20 then raise exception 'Bạn đã tạo quá nhiều link mời. Vui lòng thử sau';end if;
 insert into public.invites(group_id,token_hash,expires_at,max_uses,created_by) values(g,hashed_token,valid_until,use_limit,auth.uid()) returning id into result;
 insert into public.audit_log(group_id,actor_id,action,payload) values(g,auth.uid(),'invite_created',jsonb_build_object('invite_id',result));return result;
end $$;
create or replace function public.revoke_invite(target uuid) returns void language plpgsql security definer set search_path='' as $$
declare i public.invites;
begin
 select * into i from public.invites where id=target for update;
 if not found or not public.is_member(i.group_id) or (i.created_by is distinct from auth.uid() and not public.is_group_admin(i.group_id)) then raise exception 'Chỉ người tạo hoặc admin được thu hồi link';end if;
 update public.invites set revoked_at=coalesce(revoked_at,now()) where id=target;
 insert into public.audit_log(group_id,actor_id,action,payload) values(i.group_id,auth.uid(),'invite_revoked',jsonb_build_object('invite_id',target));
end $$;
drop policy invite_admin_read on public.invites;
create policy invite_member_read on public.invites for select to authenticated using(public.is_member(group_id) and (created_by=auth.uid() or public.is_group_admin(group_id)));

create or replace function public.session_details(sid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;s public.sessions;
begin
 result:=public.session_details_before_calendar(sid);
 select * into s from public.sessions where id=sid;
 return result||jsonb_build_object('calendar_locked',public.session_is_locked(sid),'booking_locked',s.status<>'planned','ends_at',s.ends_at,'costs_finalized_at',s.costs_finalized_at);
end $$;
revoke all on function app_private.assert_collector(uuid) from public,anon,authenticated,service_role;

create or replace function public.set_rsvp(sid uuid,going boolean) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions;actor uuid;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 if going is null or s.status<>'planned' then raise exception 'Buổi đã chốt chi phí; không thể tham gia hoặc rút';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 if exists(select 1 from public.session_attendees where session_id=sid and member_id=actor and rsvp=case when going then 'going' else 'not_going' end and committed_at is not null and removed_at is null) then return;end if;
 insert into public.session_attendees(session_id,member_id,rsvp,committed_at,commit_source) values(sid,actor,case when going then 'going' else 'not_going' end,now(),'self') on conflict(session_id,member_id) do update set rsvp=excluded.rsvp,committed_at=now(),commit_source='self',removed_at=null,removed_by=null,removal_reason=null;
 insert into public.attendance_events(session_id,member_id,actor_id,action) values(sid,actor,auth.uid(),case when going then 'committed_going' else 'committed_not_going' end);
 update public.sessions set revision=revision+1 where id=sid;
end $$;

create or replace function app_private.claim_collector(sid uuid,expected_revision bigint,court text) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions;actor uuid;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) or s.collector_member_id is not null or s.status<>'planned' or expected_revision is null or s.revision<>expected_revision then raise exception 'Không thể nhận vai trò. Buổi có thể đã thay đổi';end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and coalesce(bank_account_no,'')<>'' and coalesce(bank_bin,'')<>'' and coalesce(bank_account_name,'')<>'') then raise exception 'Cần lưu thông tin ngân hàng trước';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 update public.sessions set collector_member_id=actor,revision=revision+1 where id=sid;
 insert into public.audit_log(group_id,session_id,actor_id,action) values(s.group_id,sid,auth.uid(),'collector_claimed');
end $$;

create function public.invite_session_members(sid uuid,people uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions;target uuid;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 if s.status<>'planned' then raise exception 'Buổi đã chốt chi phí; không thể mời thêm';end if;
 if people is null or cardinality(people) not between 1 and 100 or cardinality(people)<>(select count(distinct p) from unnest(people) p) or exists(select 1 from unnest(people) p where not exists(select 1 from public.group_members where id=p and group_id=s.group_id and status='active')) then raise exception 'Người được mời phải thuộc nhóm';end if;
 for target in select unnest(people) loop
  insert into public.session_attendees(session_id,member_id,rsvp) values(sid,target,'none') on conflict do nothing;
  if found then
   insert into public.attendance_events(session_id,member_id,actor_id,action) values(sid,target,auth.uid(),'invited');
   insert into public.notifications(group_id,user_id,event_key,title,href)
    select s.group_id,user_id,'session-invite:'||sid||':'||target,'Bạn được mời: '||s.title||'. Hãy trả lời tham gia.','/sessions/'||sid from public.group_members where id=target and user_id is not null on conflict(user_id,event_key) do nothing;
  end if;
 end loop;
 -- Invitation does not alter the accepted attendance or a financial preview.
end $$;
revoke all on function public.invite_session_members(uuid,uuid[]) from public,anon,service_role;
grant execute on function public.invite_session_members(uuid,uuid[]) to authenticated;

create function public.schedule_meeting(request_key uuid,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare g uuid;sid uuid;fingerprint text;receipt app_private.financial_command_results;result jsonb;finish_time timestamptz;start_time timestamptz;people uuid[];
begin
 g:=(body->>'g')::uuid;
 if auth.uid() is null or request_key is null or not public.is_member(g) or body is null or jsonb_typeof(body)<>'object' then raise exception 'Không có quyền';end if;
 if exists(select 1 from jsonb_object_keys(body) k where k not in('g','title_text','venue_text','start_time','deadline','be_collector','nominee','ends_at','note','invitees')) or not(body ?& array['g','title_text','venue_text','start_time','deadline','be_collector','nominee','ends_at','note','invitees']) then raise exception 'Thông tin lịch không hợp lệ';end if;
 if jsonb_typeof(body->'invitees') is distinct from 'array' or jsonb_typeof(body->'note') is distinct from 'string' or length(body->>'note')>2000 then raise exception 'Thông tin lời mời không hợp lệ';end if;
 start_time:=(body->>'start_time')::timestamptz;finish_time:=(body->>'ends_at')::timestamptz;
 if finish_time is null or not isfinite(finish_time) or finish_time<=start_time or finish_time>start_time+interval '7 days' then raise exception 'Giờ kết thúc phải sau giờ bắt đầu, tối đa 7 ngày';end if;
 people:=array(select jsonb_array_elements_text(body->'invitees'))::uuid[];
 if cardinality(people)>100 or cardinality(people)<>(select count(distinct p) from unnest(people) p) then raise exception 'Danh sách lời mời không hợp lệ';end if;
 perform pg_advisory_xact_lock(hashtextextended('3t-financial-command:'||auth.uid()||':'||request_key,0));
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('command','schedule_meeting','body',body)::text,'UTF8')),'hex');
 select * into receipt from app_private.financial_command_results r where r.actor_id=auth.uid() and r.request_key=schedule_meeting.request_key;
 if found then
  if receipt.payload_hash<>fingerprint or receipt.command_name<>'schedule_meeting' then raise exception 'Mã yêu cầu đã dùng cho nội dung khác';end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 sid:=app_private.create_session_bundle((body-array['ends_at','note','invitees'])||jsonb_build_object('already_played',false,'people','[]'::jsonb,'court','0','weights','{}'::jsonb,'extras','[]'::jsonb));
 update public.sessions set ends_at=finish_time,note=nullif(trim(body->>'note'),'') where id=sid;
 if cardinality(people)>0 then perform public.invite_session_members(sid,people);end if;
 result:=jsonb_build_object('id',sid,'session_id',sid,'revision','0');
 insert into app_private.financial_command_results(actor_id,request_key,command_name,payload_hash,group_id,session_id,result) values(auth.uid(),request_key,'schedule_meeting',fingerprint,g,sid,result);
 return result||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.schedule_meeting(uuid,jsonb) from public,anon,service_role;
grant execute on function public.schedule_meeting(uuid,jsonb) to authenticated;

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
 end_time timestamptz;
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
 if s.status not in ('planned','cancelled') then raise exception 'Buổi đã chốt chi phí; lịch đã khóa'; end if;
 if expected_revision is null or s.revision<>expected_revision then raise exception 'Buổi đã thay đổi. Vui lòng tải lại'; end if;
 if s.status='settled' and s.settled_at<now()-interval '30 days' then raise exception 'Buổi đã khóa'; end if;
 if operation_name is null or operation_name not in ('edit','cancel','reopen') or body is null or jsonb_typeof(body)<>'object' then raise exception 'Thao tác không hợp lệ'; end if;
 why:=trim(body->>'reason');
 if jsonb_typeof(body->'reason') is distinct from 'string' or coalesce(length(why),0) not between 1 and 500 then raise exception 'Cần lý do thay đổi'; end if;
 if exists(select 1 from jsonb_object_keys(body) k where k not in ('title','venue','note','starts_at','ends_at','commit_deadline','reason')) then raise exception 'Chỉ được sửa thông tin lịch'; end if;
 previous:=jsonb_build_object('title',s.title,'venue',s.venue,'note',s.note,'starts_at',s.starts_at,'commit_deadline',s.commit_deadline,'status',s.status);

 if operation_name in ('edit','reopen') then
  if jsonb_typeof(body->'title') is distinct from 'string' or jsonb_typeof(body->'venue') is distinct from 'string'
   or jsonb_typeof(body->'starts_at') is distinct from 'string' or jsonb_typeof(body->'commit_deadline') is distinct from 'string'
   or (body ? 'note' and jsonb_typeof(body->'note') not in ('string','null')) then raise exception 'Thông tin lịch không hợp lệ'; end if;
  title_text:=trim(body->>'title'); venue_text:=trim(body->>'venue'); note_text:=nullif(trim(body->>'note'),'');
  start_time:=(body->>'starts_at')::timestamptz; deadline:=(body->>'commit_deadline')::timestamptz;
  end_time:=case when body ? 'ends_at' then (body->>'ends_at')::timestamptz when s.ends_at is not null then s.ends_at+(start_time-s.starts_at) else null end;
  if (body ? 'ends_at' and (jsonb_typeof(body->'ends_at') is distinct from 'string' or end_time is null)) or (end_time is not null and (not isfinite(end_time) or end_time<=start_time or end_time>start_time+interval '7 days')) then raise exception 'Giờ kết thúc không hợp lệ';end if;
  if length(title_text) not between 1 and 160 or length(venue_text) not between 1 and 200 or coalesce(length(note_text),0)>2000
   or not isfinite(start_time) or not isfinite(deadline) or deadline>start_time then raise exception 'Thông tin lịch không hợp lệ'; end if;
  schedule_changed:=start_time is distinct from s.starts_at or deadline is distinct from s.commit_deadline or end_time is distinct from s.ends_at;
 end if;

 if operation_name='edit' then
  if s.status='cancelled' then raise exception 'Mở lại buổi trước khi sửa thông tin'; end if;
  if schedule_changed and (s.status<>'planned' or start_time<=now()) then
   raise exception 'Chỉ được đổi giờ hoặc hạn chốt khi chưa đến hạn chốt';
  end if;
  if not schedule_changed and previous=jsonb_build_object('title',title_text,'venue',venue_text,'note',note_text,'starts_at',start_time,'commit_deadline',deadline,'status',s.status) then return; end if;
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
  update public.sessions set title=title_text,venue=venue_text,note=note_text,starts_at=start_time,ends_at=end_time,commit_deadline=deadline,
   status=case when operation_name='reopen' then 'planned' else status end,
   settled_at=case when operation_name='reopen' then null else settled_at end,
   schedule_generation=schedule_generation+case when reset_choices then 1 else 0 end,revision=revision+1 where id=sid;
 end if;
 select jsonb_build_object('title',title,'venue',venue,'note',note,'starts_at',starts_at,'commit_deadline',commit_deadline,'status',status) into current_data from public.sessions where id=sid;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,sid,auth.uid(),event_name,jsonb_build_object('reason',why,'before',previous,'after',current_data,'rsvp_reset',reset_choices));
 perform public.notify_group(s.group_id,'session-calendar:'||sid||':'||(s.revision+1),
  case when operation_name='cancel' then 'Buổi đã hủy: ' when operation_name='reopen' then 'Buổi mở lại; hãy tự chốt tham gia: ' when reset_choices then 'Lịch đã đổi; hãy tự chốt tham gia lại: ' else 'Thông tin buổi đã cập nhật: ' end || s.title,'/sessions/'||sid);
end $$;
create or replace function app_private.finish_session(sid uuid,expected_revision bigint,court text) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions; actor uuid; eid uuid; total bigint;
begin
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
 update public.sessions set status='played',costs_finalized_at=now() where id=sid;
 perform public.recalculate_session(sid,'Hoàn tất buổi chơi');
end $$;
create or replace function public.request_session_change(sid uuid,kind text,body jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.sessions;actor uuid;canonical jsonb;candidate uuid;authority uuid;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 if kind is null or kind not in ('join','leave','weight','collector_nomination') or length(trim(coalesce(body->>'reason',''))) not between 1 and 500 then raise exception 'Yêu cầu không hợp lệ';end if;
 if s.status<>'planned' or (public.session_is_locked(s.id)) then raise exception 'Buổi đã khóa';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 authority:=s.collector_member_id;
 if kind='collector_nomination' then

 candidate:=(body->>'member_id')::uuid;
 if not exists(select 1 from public.group_members where id=candidate and group_id=s.group_id and status='active' and user_id is not null) or candidate=s.collector_member_id then raise exception 'Người được đề cử không hợp lệ';end if;
 canonical:=jsonb_build_object('member_id',candidate,'reason',trim(body->>'reason'),'phase',case when s.collector_member_id is not null and actor<>s.collector_member_id then 'consent' else 'accept' end);
 if canonical->>'phase'='accept' then authority:=candidate;end if;
 if exists(select 1 from public.approval_requests where session_id=sid and type='collector_nomination' and status='pending' and expires_at>now()) then raise exception 'Đang có đề cử chờ xử lý';end if;
 update public.sessions set collector_nominee_member_id=candidate where id=sid;
 else
 if authority is null then raise exception 'Cần có người tính tiền trước';end if;
 if kind in ('join','leave') then raise exception 'Hãy tự nhận lời hoặc rút trước khi buổi chốt chi phí';end if;
 if kind in ('leave','weight') and not exists(select 1 from public.session_attendees where session_id=sid and member_id=actor and rsvp='going' and removed_at is null) then raise exception 'Bạn chưa tham gia';end if;
 if kind='join' and exists(select 1 from public.session_attendees where session_id=sid and member_id=actor and rsvp='going' and removed_at is null) then raise exception 'Bạn đã tham gia';end if;
 canonical:=jsonb_build_object('member_id',actor,'reason',trim(body->>'reason'));
 if kind='weight' then
 if (body->>'weight')::numeric<=0 or (body->>'weight')::numeric>100 or (body->>'weight')::numeric<>round((body->>'weight')::numeric,6) or body->>'weight' is null then raise exception 'Hệ số không hợp lệ';end if;
 canonical:=canonical||jsonb_build_object('weight',body->>'weight');end if;
 end if;
 return public.new_session_request(sid,kind,canonical,authority::text);
end $$;
