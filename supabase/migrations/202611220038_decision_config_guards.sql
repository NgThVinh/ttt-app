create or replace function public.configure_group_decisions(g uuid,expected_revision bigint,model_id text,reason text) returns void language plpgsql security definer set search_path='' as $$
declare s public.group_ai_settings;
begin
 if not public.is_super_admin() then raise exception 'Chỉ super admin được cấu hình';end if;
 select * into s from public.group_ai_settings where group_id=g for update;
 if not found or s.revision is distinct from expected_revision or s.status is distinct from 'approved' or s.enabled is distinct from true or s.provider is distinct from 'openai-compatible' or s.base_url is distinct from 'https://openrouter.ai/api/v1' then raise exception 'Nhóm chưa bật OpenRouter hoặc cấu hình đã đổi';end if;
 if coalesce(length(trim(reason)),0) not between 1 and 500 then raise exception 'Cần lý do';end if;
 update public.group_ai_settings set decision_model=model_id,revision=revision+1 where group_id=g;
 insert into public.audit_log(group_id,actor_id,action,payload) values(g,auth.uid(),'ai_decision_routing_configured',jsonb_build_object('model',model_id,'reason',trim(reason)));
end $$;
revoke all on function public.configure_group_decisions(uuid,bigint,text,text) from public,anon,service_role;
grant execute on function public.configure_group_decisions(uuid,bigint,text,text) to authenticated;
