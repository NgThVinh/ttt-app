-- Send changes only to authenticated subscribers allowed by existing SELECT RLS.
-- No new table grants or replica-identity changes; primary keys suffice to refresh.
do $$
declare target text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime' and not puballtables) then
    foreach target in array array['sessions','session_attendees','settlements'] loop
      if not exists(select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=target) then
        execute format('alter publication supabase_realtime add table public.%I',target);
      end if;
    end loop;
  end if;
end $$;

-- Fixed-size dashboard summary instead of returning every historical transfer.
create function public.my_debt_summary() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'owe',coalesce(sum(p.amount) filter(where f.user_id=auth.uid()),0)::text,
    'owed',coalesce(sum(p.amount) filter(where t.user_id=auth.uid()),0)::text,
    'payCount',count(*) filter(where f.user_id=auth.uid()),
    'receiveCount',count(*) filter(where t.user_id=auth.uid())
  ) from public.settlements p
  join public.sessions s on s.id=p.session_id
  join public.group_members f on f.id=p.from_member
  join public.group_members t on t.id=p.to_member
  where public.is_member(s.group_id)
    and (f.user_id=auth.uid() or t.user_id=auth.uid())
    and p.status not in ('cancelled','confirmed')
$$;
revoke all on function public.my_debt_summary() from public,anon,service_role;
grant execute on function public.my_debt_summary() to authenticated;
