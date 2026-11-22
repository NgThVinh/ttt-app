-- Rescheduled games receive their own deduplicated reminder stages.
create or replace function public.run_scheduled_jobs_core() returns void language plpgsql security definer set search_path='' as $$
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
 select s.group_id,m.user_id,'commit:'||s.id||case when s.schedule_generation=0 then '' else ':'||s.schedule_generation end||':'||stage,'Nhớ chốt đi hoặc không đi: '||s.title,'/sessions/'||s.id
 from public.sessions s join public.group_members m on m.group_id=s.group_id and m.status='active' and m.user_id is not null
 left join public.session_attendees a on a.session_id=s.id and a.member_id=m.id
 where s.status='planned' and s.commit_deadline>now() and s.commit_deadline<=now()+case when stage=1 then interval '1 day' else interval '2 hours' end and (a.committed_at is null)
 and (stage=2 or s.commit_deadline>now()+interval '2 hours') on conflict(user_id,event_key) do nothing;
 end loop;
 insert into public.notifications(group_id,user_id,event_key,title,href)
 select s.group_id,m.user_id,'play:'||s.id||case when s.schedule_generation=0 then '' else ':'||s.schedule_generation end,'Sắp đến giờ ra sân: '||s.title,'/sessions/'||s.id from public.sessions s join public.session_attendees a on a.session_id=s.id and a.rsvp='going' and a.committed_at is not null and a.removed_at is null join public.group_members m on m.id=a.member_id and m.status='active' and m.user_id is not null where s.status='planned' and s.starts_at>now() and s.starts_at<=now()+interval '2 hours' on conflict(user_id,event_key) do nothing;
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
revoke all on function public.run_scheduled_jobs_core() from public,anon,authenticated;
