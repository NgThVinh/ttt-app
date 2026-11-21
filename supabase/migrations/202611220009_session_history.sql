alter function public.session_details(uuid) rename to session_details_core;
revoke all on function public.session_details_core(uuid) from public,anon,authenticated;
create function public.session_details(sid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.session_details_core(sid);
 return result||jsonb_build_object('history',(
 select coalesce(jsonb_agg(jsonb_build_object('action',events.action,'created_at',events.created_at,'reason',events.reason,'actor_name',coalesce(m.display_name,'Hệ thống')) order by events.created_at desc),'[]')
 from (
 select a.action,a.created_at,a.payload->>'reason' reason,a.actor_id,a.group_id from public.audit_log a where a.session_id=sid and a.action<>'allocation_snapshot'
 union all select a.action,a.created_at,a.reason,a.actor_id,s.group_id from public.attendance_events a join public.sessions s on s.id=a.session_id where a.session_id=sid
 ) events left join public.group_members m on m.group_id=events.group_id and m.user_id=events.actor_id));
end $$;
revoke all on function public.session_details(uuid) from public,anon;
grant execute on function public.session_details(uuid) to authenticated;
