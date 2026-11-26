-- Recurrence is an explicit option on creation. Keep its metadata with the series.
alter table public.weekly_series
  add column duration interval check(duration > interval '0' and duration <= interval '7 days'),
  add column note text,
  add column invited_member_ids uuid[] not null default '{}';

-- Preserve existing sessions; enrich only their series template.
update public.weekly_series w set
  duration = case when s.ends_at>s.starts_at and s.ends_at<=s.starts_at+interval '7 days' then s.ends_at-s.starts_at end,
  note = s.note,
  invited_member_ids = coalesce((select array_agg(a.member_id order by a.member_id) from public.session_attendees a where a.session_id=s.id and a.removed_at is null),'{}'::uuid[])
from public.sessions s
where s.id = (select first_session.id from public.sessions first_session where first_session.weekly_series_id=w.id order by first_session.starts_at,first_session.id limit 1);

create or replace function public.generate_weekly_sessions() returns void language plpgsql security definer set search_path='' as $$
declare series public.weekly_series; sid uuid; next_time timestamptz; invited uuid;
begin
 for series in select * from public.weekly_series where active for update skip locked loop
  if not exists(select 1 from public.group_members where group_id=series.group_id and user_id=series.created_by and status='active') then continue;end if;
  next_time:=series.next_starts_at;
  while next_time<=series.until_at and next_time<=now()+interval '28 days' loop
   if next_time-series.deadline_offset>now() then
    sid:=null;
    insert into public.sessions(group_id,title,venue,starts_at,ends_at,note,commit_deadline,created_by,weekly_series_id)
    values(series.group_id,series.title,series.venue,next_time,next_time+series.duration,series.note,next_time-series.deadline_offset,series.created_by,series.id)
    on conflict(weekly_series_id,starts_at) where weekly_series_id is not null do nothing returning id into sid;
    if sid is not null then
     for invited in select m.id from public.group_members m where m.id=any(series.invited_member_ids) and m.group_id=series.group_id and m.status='active' loop
      insert into public.session_attendees(session_id,member_id,rsvp) values(sid,invited,'none');
      insert into public.attendance_events(session_id,member_id,actor_id,action) values(sid,invited,null,'invited');
     end loop;
     perform public.notify_group(series.group_id,'weekly:'||sid,'Buổi lặp mới: '||series.title||'. Hãy tự nhận lời tham gia.','/sessions/'||sid);
     insert into public.audit_log(group_id,session_id,action) values(series.group_id,sid,'weekly_session_created');
    end if;
   end if;
   next_time:=next_time+interval '7 days';
  end loop;
  update public.weekly_series set next_starts_at=next_time,active=(next_time<=until_at) where id=series.id;
 end loop;
end $$;

create or replace function public.set_weekly_series(sid uuid,weeks integer) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions; series uuid;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) or s.created_by<>auth.uid() or s.status<>'planned' or s.starts_at<=now() or weeks is null or weeks not between 1 and 12 or s.weekly_series_id is not null then raise exception 'Không thể tạo lịch lặp';end if;
 insert into public.weekly_series(group_id,title,venue,next_starts_at,deadline_offset,until_at,created_by,duration,note,invited_member_ids)
 values(s.group_id,s.title,s.venue,s.starts_at+interval '7 days',s.starts_at-s.commit_deadline,s.starts_at+weeks*interval '7 days',auth.uid(),s.ends_at-s.starts_at,s.note,
  coalesce((select array_agg(member_id order by member_id) from public.session_attendees where session_id=sid and removed_at is null),'{}'::uuid[])) returning id into series;
 update public.sessions set weekly_series_id=series where id=sid;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,sid,auth.uid(),'weekly_series_started',jsonb_build_object('weeks',weeks,'series_id',series));
 perform public.generate_weekly_sessions();
end $$;

-- A distinct RPC makes an outdated deployment fail visibly instead of ignoring repeat.
-- The receipt covers repeat and poll source; all nested writes roll back together.
create function public.schedule_calendar_meeting(request_key uuid,body jsonb,source_poll uuid default null,chosen_option uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g uuid; fingerprint text; receipt app_private.financial_command_results; result jsonb; sid uuid; repeat_count integer; inner_key uuid;
begin
 if auth.uid() is null or request_key is null or body is null or jsonb_typeof(body)<>'object' then raise exception 'Không có quyền';end if;
 g:=(body->>'g')::uuid;
 if not public.is_member(g) then raise exception 'Không có quyền';end if;
 if (source_poll is null) <> (chosen_option is null) then raise exception 'Nguồn thăm dò không hợp lệ';end if;
 if coalesce(body->>'repeat_weeks','0') !~ '^[0-9]{1,2}$' then raise exception 'Số tuần lặp không hợp lệ';end if;
 repeat_count:=coalesce(body->>'repeat_weeks','0')::integer;
 if repeat_count not between 0 and 12 then raise exception 'Số tuần lặp không hợp lệ';end if;
 perform pg_advisory_xact_lock(hashtextextended('3t-financial-command:'||auth.uid()||':'||request_key,0));
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('body',body,'poll',source_poll,'option',chosen_option)::text,'UTF8')),'hex');
 select * into receipt from app_private.financial_command_results r where r.actor_id=auth.uid() and r.request_key=schedule_calendar_meeting.request_key;
 if found then
  if receipt.command_name<>'schedule_calendar_meeting' or receipt.payload_hash<>fingerprint then raise exception 'Mã yêu cầu đã dùng cho nội dung khác';end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 inner_key:=md5('calendar-meeting:'||request_key::text)::uuid;
 if source_poll is null then result:=public.schedule_meeting(inner_key,body-'repeat_weeks');
 else result:=public.schedule_poll_meeting(inner_key,source_poll,chosen_option,body-'repeat_weeks');end if;
 if (result->>'replayed')::boolean then raise exception 'Mã yêu cầu đã dùng; hãy mở lại form';end if;
 sid:=(result->>'id')::uuid;
 if repeat_count>0 then perform public.set_weekly_series(sid,repeat_count);end if;
 insert into app_private.financial_command_results(actor_id,request_key,command_name,payload_hash,group_id,session_id,result)
 values(auth.uid(),request_key,'schedule_calendar_meeting',fingerprint,g,sid,result);
 return result||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.schedule_calendar_meeting(uuid,jsonb,uuid,uuid) from public,anon,service_role;
grant execute on function public.schedule_calendar_meeting(uuid,jsonb,uuid,uuid) to authenticated;
