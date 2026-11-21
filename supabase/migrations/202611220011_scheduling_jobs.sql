create table public.weekly_series(id uuid primary key default gen_random_uuid(),group_id uuid not null references public.groups,title text not null,venue text not null,next_starts_at timestamptz not null,deadline_offset interval not null check(deadline_offset>=interval '0'),until_at timestamptz not null,active boolean not null default true,created_by uuid not null references auth.users,created_at timestamptz not null default now());
alter table public.attendance_events alter column actor_id drop not null;
alter table public.weekly_series enable row level security;
create policy weekly_read on public.weekly_series for select to authenticated using(public.is_member(group_id));
revoke all on public.weekly_series from public,anon,authenticated;
grant select on public.weekly_series to authenticated;
alter table public.sessions add column weekly_series_id uuid references public.weekly_series;
create unique index weekly_instance on public.sessions(weekly_series_id,starts_at) where weekly_series_id is not null;
create function public.generate_weekly_sessions() returns void language plpgsql security definer set search_path='' as $$
declare series public.weekly_series;sid uuid;next_time timestamptz;
begin
 for series in select * from public.weekly_series where active for update skip locked loop
 if not exists(select 1 from public.group_members where group_id=series.group_id and user_id=series.created_by and status='active') then continue;end if;
 next_time:=series.next_starts_at;
 while next_time<=series.until_at and next_time<=now()+interval '28 days' loop
 if next_time-series.deadline_offset>now() then
 insert into public.sessions(group_id,title,venue,starts_at,commit_deadline,created_by,weekly_series_id) values(series.group_id,series.title,series.venue,next_time,next_time-series.deadline_offset,series.created_by,series.id) on conflict(weekly_series_id,starts_at) where weekly_series_id is not null do nothing returning id into sid;
 if sid is not null then perform public.notify_group(series.group_id,'weekly:'||sid,'Buổi lặp mới: '||series.title,'/sessions/'||sid);insert into public.audit_log(group_id,session_id,action) values(series.group_id,sid,'weekly_session_created');end if;
 end if;
 next_time:=next_time+interval '7 days';
 end loop;
 update public.weekly_series set next_starts_at=next_time,active=(next_time<=until_at) where id=series.id;
 end loop;
end $$;
create function public.set_weekly_series(sid uuid,weeks integer) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions;series uuid;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) or s.created_by<>auth.uid() or s.status<>'planned' or s.starts_at<=now() or weeks is null or weeks not between 1 and 12 or s.weekly_series_id is not null then raise exception 'Không thể tạo lịch lặp';end if;
 insert into public.weekly_series(group_id,title,venue,next_starts_at,deadline_offset,until_at,created_by) values(s.group_id,s.title,s.venue,s.starts_at+interval '7 days',s.starts_at-s.commit_deadline,s.starts_at+weeks*interval '7 days',auth.uid()) returning id into series;
 update public.sessions set weekly_series_id=series where id=sid;
 perform public.generate_weekly_sessions();
end $$;
create function public.stop_weekly_series(target uuid) returns void language plpgsql security definer set search_path='' as $$
declare g uuid;creator uuid;
begin
 select group_id,created_by into g,creator from public.weekly_series where id=target for update;
 if not public.is_member(g) or (creator<>auth.uid() and not public.is_group_admin(g)) then raise exception 'Không có quyền dừng lịch lặp';end if;
 update public.weekly_series set active=false where id=target;
end $$;

create function public.run_scheduled_jobs() returns void language plpgsql security definer set search_path='' as $$
declare due_session public.sessions;uncommitted record;stage integer;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('3t-scheduled-jobs',0)) then return;end if;
 perform public.generate_weekly_sessions();
 -- Deadlines are also enforced synchronously by every RSVP operation.
 for due_session in select * from public.sessions where status='planned' and commit_deadline<=now() for update skip locked loop
 for uncommitted in select m.id from public.group_members m left join public.session_attendees a on a.session_id=due_session.id and a.member_id=m.id where m.group_id=due_session.group_id and m.status='active' and (a.member_id is null or a.committed_at is null) loop
 insert into public.session_attendees(session_id,member_id,rsvp,committed_at,commit_source) values(due_session.id,uncommitted.id,'not_going',now(),'auto_not_going') on conflict(session_id,member_id) do update set rsvp='not_going',committed_at=now(),commit_source='auto_not_going';
 insert into public.attendance_events(session_id,member_id,action,session_status_at_time) values(due_session.id,uncommitted.id,'auto_not_going',due_session.status);
 update public.sessions set revision=revision+1 where id=due_session.id;
 end loop;
 end loop;
 -- Reminders: one day/two hours before commitment, two hours before play.
 for stage in 1..2 loop
 insert into public.notifications(group_id,user_id,event_key,title,href)
 select s.group_id,m.user_id,'commit:'||s.id||':'||stage,'Nhớ chốt đi hoặc không đi: '||s.title,'/sessions/'||s.id
 from public.sessions s join public.group_members m on m.group_id=s.group_id and m.status='active' and m.user_id is not null
 left join public.session_attendees a on a.session_id=s.id and a.member_id=m.id
 where s.status='planned' and s.commit_deadline>now() and s.commit_deadline<=now()+case when stage=1 then interval '1 day' else interval '2 hours' end and (a.committed_at is null)
 and (stage=2 or s.commit_deadline>now()+interval '2 hours') on conflict(user_id,event_key) do nothing;
 end loop;
 insert into public.notifications(group_id,user_id,event_key,title,href)
 select s.group_id,m.user_id,'play:'||s.id,'Sắp đến giờ ra sân: '||s.title,'/sessions/'||s.id from public.sessions s join public.session_attendees a on a.session_id=s.id and a.rsvp='going' and a.committed_at is not null and a.removed_at is null join public.group_members m on m.id=a.member_id and m.status='active' and m.user_id is not null where s.status='planned' and s.starts_at>now() and s.starts_at<=now()+interval '2 hours' on conflict(user_id,event_key) do nothing;
 for stage in 1..2 loop
 insert into public.notifications(group_id,user_id,event_key,title,href)
 select p.group_id,m.user_id,'poll-reminder:'||p.id||':'||stage,'Cùng chọn lịch: '||p.title,'/polls/'||p.id from public.polls p join public.group_members m on m.group_id=p.group_id and m.status='active' and m.user_id is not null where p.status='open' and p.closes_at>now() and ((stage=1 and p.created_at<=now()-interval '1 day') or (stage=2 and p.closes_at<=now()+interval '1 day')) and not exists(select 1 from public.poll_votes v join public.poll_options o on o.id=v.option_id where o.poll_id=p.id and v.member_id=m.id) on conflict(user_id,event_key) do nothing;
 end loop;
 for stage in 1..3 loop
 insert into public.notifications(group_id,user_id,event_key,title,href)
 select s.group_id,m.user_id,'debt:'||p.id||':'||stage,'Bạn còn khoản cần trả trong buổi: '||s.title,'/sessions/'||s.id from public.settlements p join public.sessions s on s.id=p.session_id join public.group_members m on m.id=p.from_member and m.status='active' and m.user_id is not null where p.status='pending' and p.created_at<=now()-case when stage=1 then interval '1 day' when stage=2 then interval '3 days' else interval '7 days' end and (stage=3 or p.created_at>now()-case when stage=1 then interval '3 days' else interval '7 days' end) on conflict(user_id,event_key) do nothing;
 end loop;
 for stage in 1..2 loop
 insert into public.notifications(group_id,user_id,event_key,title,href)
 select s.group_id,m.user_id,'receipt:'||p.id||':'||stage,'Kiểm tra sao kê và xác nhận khoản đã nhận: '||s.title,'/sessions/'||s.id from public.settlements p join public.sessions s on s.id=p.session_id join public.group_members m on m.id=p.to_member and m.status='active' and m.user_id is not null where p.status='marked_paid' and p.marked_paid_at<=now()-stage*interval '1 day' and (stage=2 or p.marked_paid_at>now()-interval '2 days') on conflict(user_id,event_key) do nothing;
 insert into public.notifications(group_id,user_id,event_key,title,href)
 select r.group_id,m.user_id,'approval:'||r.id||':'||stage,'Có yêu cầu đang chờ bạn duyệt',case when r.session_id is null then '/groups/'||r.group_id else '/approvals' end from public.approval_requests r join public.group_members m on m.group_id=r.group_id and (m.id::text=r.required_authority or (r.required_authority='group_admin' and m.role='admin')) and m.status='active' and m.user_id is not null where r.status='pending' and r.expires_at>now() and r.created_at<=now()-stage*interval '1 day' and (stage=2 or r.created_at>now()-interval '2 days') on conflict(user_id,event_key) do nothing;
 end loop;
 insert into public.notifications(group_id,user_id,event_key,title,href)
 select r.group_id,m.user_id,'escalate-request:'||r.id,'Yêu cầu chờ quá 72 giờ cần admin xem lại','/approvals' from public.approval_requests r join public.group_members m on m.group_id=r.group_id and m.role='admin' and m.status='active' and m.user_id is not null where r.status='pending' and r.expires_at<=now() on conflict(user_id,event_key) do nothing;
 insert into public.notifications(group_id,user_id,event_key,title,href)
 select s.group_id,m.user_id,'escalate-receipt:'||p.id,'Khoản báo chuyển chờ quá 72 giờ cần admin xem lại','/sessions/'||s.id from public.settlements p join public.sessions s on s.id=p.session_id join public.group_members m on m.group_id=s.group_id and m.role='admin' and m.status='active' and m.user_id is not null where p.status='marked_paid' and p.marked_paid_at<=now()-interval '72 hours' on conflict(user_id,event_key) do nothing;
 update public.expenses set status='rejected' where status='proposed' and approval_request_id in(select id from public.approval_requests where status='pending' and expires_at<=now());
 update public.approval_requests set status='expired' where status='pending' and expires_at<=now();
end $$;
revoke all on function public.generate_weekly_sessions(),public.run_scheduled_jobs() from public,anon,authenticated;
revoke all on function public.set_weekly_series(uuid,integer),public.stop_weekly_series(uuid) from public,anon;
grant execute on function public.set_weekly_series(uuid,integer),public.stop_weekly_series(uuid) to authenticated;
