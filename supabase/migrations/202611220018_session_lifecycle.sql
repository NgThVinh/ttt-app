-- A separate schedule generation keeps reminder deduplication independent of
-- payment/attendance revisions, while allowing reminders for a rescheduled game.
alter table public.sessions add column schedule_generation integer not null default 0;

create function public.manage_session(sid uuid, expected_revision bigint, operation_name text, body jsonb)
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
 if s.status='settled' and s.settled_at<now()-interval '30 days' then raise exception 'Buổi đã khóa'; end if;
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
revoke all on function public.manage_session(uuid,bigint,text,jsonb) from public,anon;
grant execute on function public.manage_session(uuid,bigint,text,jsonb) to authenticated;

alter function public.session_details(uuid) rename to session_details_before_calendar;
revoke all on function public.session_details_before_calendar(uuid) from public,anon,authenticated;
create function public.session_details(sid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; locked boolean;
begin
 result:=public.session_details_before_calendar(sid);
 select status='settled' and settled_at<now()-interval '30 days' into locked from public.sessions where id=sid;
 return result||jsonb_build_object('calendar_locked',coalesce(locked,false));
end $$;
revoke all on function public.session_details(uuid) from public,anon;
grant execute on function public.session_details(uuid) to authenticated;
