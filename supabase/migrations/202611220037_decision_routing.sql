alter table public.group_ai_settings add column decision_model text check(decision_model is null or decision_model in ('perplexity/pplx-decider-flash-v1.3:free','perplexity/pplx-decider-v1.3:free'));
create function public.configure_group_decisions(g uuid,expected_revision bigint,model_id text,reason text) returns void language plpgsql security definer set search_path='' as $$
declare s public.group_ai_settings;
begin
 if not public.is_super_admin() then raise exception 'Chỉ super admin được cấu hình';end if;
 select * into s from public.group_ai_settings where group_id=g for update;
 if not found or s.revision<>expected_revision or s.status<>'approved' or not s.enabled or s.provider<>'openai-compatible' or s.base_url<>'https://openrouter.ai/api/v1' then raise exception 'Nhóm chưa bật OpenRouter hoặc cấu hình đã đổi';end if;
 if coalesce(length(trim(reason)),0) not between 1 and 500 then raise exception 'Cần lý do';end if;
 update public.group_ai_settings set decision_model=model_id,revision=revision+1 where group_id=g;
 insert into public.audit_log(group_id,actor_id,action,payload) values(g,auth.uid(),'ai_decision_routing_configured',jsonb_build_object('model',model_id,'reason',trim(reason)));
end $$;
revoke all on function public.configure_group_decisions(uuid,bigint,text,text) from public,anon,service_role;
grant execute on function public.configure_group_decisions(uuid,bigint,text,text) to authenticated;
