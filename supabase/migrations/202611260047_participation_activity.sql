-- Bounded aggregates, computed before API row limits and scoped to active memberships.
create function public.my_participation_activity() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare today date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date;
 first_day date; result jsonb;
begin
 if auth.uid() is null then raise exception 'Cần đăng nhập';end if;
 first_day:=date_trunc('week',today::timestamp)::date-175;
 select coalesce(jsonb_agg(to_jsonb(d) order by d.day),'[]'::jsonb) into result from (
  select (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::date as "day",
   count(*)::integer group_sessions,
   count(*) filter(where exists(
    select 1 from public.session_attendees a join public.group_members m on m.id=a.member_id
    where a.session_id=s.id and m.group_id=s.group_id and m.user_id=auth.uid() and m.status='active'
     and a.removed_at is null and a.rsvp='going' and a.committed_at is not null
   ))::integer mine
  from public.sessions s
  where s.deleted_at is null and s.status in ('played','settled') and s.starts_at<=now()
   and s.starts_at >= (first_day::timestamp at time zone 'Asia/Ho_Chi_Minh')
   and public.is_member(s.group_id)
  group by (s.starts_at at time zone 'Asia/Ho_Chi_Minh')::date
 ) d;
 return jsonb_build_object('today',today,'days',result,'group_count',(
  select count(distinct group_id)::integer from public.group_members where user_id=auth.uid() and status='active'
 ));
end $$;
revoke all on function public.my_participation_activity() from public,anon,service_role;
grant execute on function public.my_participation_activity() to authenticated;
