-- Super admins need to review requests from groups they do not belong to.
-- This directory exposes only group labels and never grants business access.
create function public.ai_admin_groups() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_super_admin() then raise exception 'Chỉ super admin được xem';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name),'[]') from public.groups g join public.group_ai_settings s on s.group_id=g.id);
end $$;
revoke all on function public.ai_admin_groups() from public,anon,service_role;
grant execute on function public.ai_admin_groups() to authenticated;
alter table public.group_ai_settings add constraint approved_ai_configuration check(status<>'approved' or (provider is not null and model is not null and length(model) between 1 and 120 and key_suffix is not null and length(key_suffix)=4));
