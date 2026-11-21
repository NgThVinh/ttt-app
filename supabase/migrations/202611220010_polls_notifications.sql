create table public.polls(id uuid primary key default gen_random_uuid(),group_id uuid not null references public.groups,title text not null check(length(trim(title)) between 1 and 160),venue text not null check(length(trim(venue)) between 1 and 200),min_attendees integer not null check(min_attendees between 1 and 100),closes_at timestamptz not null,status text not null default 'open' check(status in ('open','closed')),resulting_session_id uuid references public.sessions,created_by uuid not null references auth.users,created_at timestamptz not null default now());
create table public.poll_options(id uuid primary key default gen_random_uuid(),poll_id uuid not null references public.polls,starts_at timestamptz not null,ends_at timestamptz not null check(ends_at>starts_at),created_at timestamptz not null default now(),unique(poll_id,starts_at,ends_at));
create table public.poll_votes(option_id uuid references public.poll_options,member_id uuid references public.group_members,answer text not null check(answer in ('yes','maybe','no')),created_at timestamptz not null default now(),primary key(option_id,member_id));
create table public.notifications(id uuid primary key default gen_random_uuid(),group_id uuid not null references public.groups,user_id uuid not null references auth.users,event_key text not null,title text not null,href text not null,read_at timestamptz,created_at timestamptz not null default now(),unique(user_id,event_key));
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.notifications enable row level security;
create policy poll_read on public.polls for select to authenticated using(public.is_member(group_id));
create policy poll_option_read on public.poll_options for select to authenticated using(exists(select 1 from public.polls p where p.id=poll_id and public.is_member(p.group_id)));
create policy poll_vote_read on public.poll_votes for select to authenticated using(exists(select 1 from public.poll_options o join public.polls p on p.id=o.poll_id where o.id=option_id and public.is_member(p.group_id)));
create policy notification_read on public.notifications for select to authenticated using(user_id=auth.uid() and public.is_member(group_id));
revoke all on public.polls,public.poll_options,public.poll_votes,public.notifications from public,anon,authenticated;
grant select on public.polls,public.poll_options,public.poll_votes,public.notifications to authenticated;
create function public.notify_group(g uuid,event text,message text,link text) returns void language sql security definer set search_path='' as $$
 insert into public.notifications(group_id,user_id,event_key,title,href) select g,user_id,event,message,link from public.group_members where group_id=g and status='active' and user_id is not null on conflict(user_id,event_key) do nothing
$$;
revoke all on function public.notify_group(uuid,text,text,text) from public,anon,authenticated;
create function public.create_poll(g uuid,title_text text,venue_text text,minimum integer,deadline timestamptz,options jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare pid uuid;o jsonb;first_start timestamptz;
begin
 if not public.is_member(g) then raise exception 'Không có quyền';end if;
 if options is null or jsonb_typeof(options)<>'array' or jsonb_array_length(options) not between 1 and 24 or minimum is null or minimum not between 1 and 100 or deadline is null or deadline<=now() then raise exception 'Thăm dò không hợp lệ';end if;
 select min((value->>'starts_at')::timestamptz) into first_start from jsonb_array_elements(options);
 if first_start<=now() or deadline>first_start then raise exception 'Hạn thăm dò phải trước khung giờ đầu tiên';end if;
 insert into public.polls(group_id,title,venue,min_attendees,closes_at,created_by) values(g,title_text,venue_text,minimum,deadline,auth.uid()) returning id into pid;
 for o in select value from jsonb_array_elements(options) loop
 insert into public.poll_options(poll_id,starts_at,ends_at) values(pid,(o->>'starts_at')::timestamptz,(o->>'ends_at')::timestamptz);
 end loop;
 perform public.notify_group(g,'poll:'||pid,'Cùng chọn lịch: '||title_text,'/polls/'||pid);
 insert into public.audit_log(group_id,actor_id,action,payload) values(g,auth.uid(),'poll_created',jsonb_build_object('poll_id',pid));return pid;
end $$;
create function public.vote_poll(target uuid,response text) returns void language plpgsql security definer set search_path='' as $$
declare p public.polls;actor uuid;
begin
 select poll.* into p from public.polls poll join public.poll_options o on o.poll_id=poll.id where o.id=target for update of poll;
 if not found or not public.is_member(p.group_id) then raise exception 'Không có quyền';end if;
 if p.status<>'open' or p.closes_at<=now() or response is null or response not in ('yes','maybe','no') then raise exception 'Thăm dò đã hết hạn hoặc câu trả lời không hợp lệ';end if;
 select id into actor from public.group_members where group_id=p.group_id and user_id=auth.uid() and status='active';
 insert into public.poll_votes(option_id,member_id,answer) values(target,actor,response) on conflict(option_id,member_id) do update set answer=excluded.answer;
end $$;
create function public.close_poll(target uuid,chosen uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.polls;o public.poll_options;sid uuid;
begin
 select * into p from public.polls where id=target for update;
 if not found or not public.is_member(p.group_id) or (p.created_by<>auth.uid() and not public.is_group_admin(p.group_id)) then raise exception 'Chỉ người tạo thăm dò hoặc admin được chốt';end if;
 if p.status='closed' then return p.resulting_session_id;end if;
 select * into o from public.poll_options where id=chosen and poll_id=target;
 if not found or o.starts_at<=now() then raise exception 'Khung giờ không hợp lệ';end if;
 if (select count(*) from public.poll_votes v join public.group_members m on m.id=v.member_id where v.option_id=chosen and v.answer='yes' and m.status='active' and m.group_id=p.group_id)<p.min_attendees then raise exception 'Chưa đủ số người tối thiểu';end if;
 sid:=public.create_session(p.group_id,p.title,p.venue,o.starts_at,o.starts_at,false,'{}','0',false);
 insert into public.session_attendees(session_id,member_id,rsvp) select sid,v.member_id,case when v.answer='yes' then 'going' else 'maybe' end from public.poll_votes v join public.group_members m on m.id=v.member_id where v.option_id=chosen and v.answer in ('yes','maybe') and m.status='active';
 update public.polls set status='closed',resulting_session_id=sid where id=target;
 perform public.notify_group(p.group_id,'poll-closed:'||target,'Đã chốt lịch: '||p.title||'. Mỗi người nhớ tự chốt tham gia.','/sessions/'||sid);
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(p.group_id,sid,auth.uid(),'poll_closed',jsonb_build_object('poll_id',target,'option_id',chosen));return sid;
end $$;
create function public.mark_notification_read(target uuid) returns void language sql security definer set search_path='' as $$
 update public.notifications set read_at=coalesce(read_at,now()) where id=target and user_id=auth.uid() and public.is_member(group_id)
$$;
revoke all on function public.create_poll(uuid,text,text,integer,timestamptz,jsonb),public.vote_poll(uuid,text),public.close_poll(uuid,uuid),public.mark_notification_read(uuid) from public,anon;
grant execute on function public.create_poll(uuid,text,text,integer,timestamptz,jsonb),public.vote_poll(uuid,text),public.close_poll(uuid,uuid),public.mark_notification_read(uuid) to authenticated;
create index poll_groups on public.polls(group_id,status);
create index notification_inbox on public.notifications(user_id,created_at desc);
-- Publish only non-financial changes; subscriber authorization remains enforced by RLS.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime' and not puballtables) then
 alter publication supabase_realtime add table public.polls,public.poll_options,public.poll_votes,public.notifications;
 end if;
end $$;
