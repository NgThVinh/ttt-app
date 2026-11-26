-- Admins configure their own group's AI directly; no approval request is created.
alter table public.group_ai_settings drop constraint approved_ai_configuration;
alter table public.group_ai_settings add constraint enabled_ai_configuration check(not enabled or (status='approved' and provider is not null and model is not null and length(model) between 1 and 120 and key_suffix is not null and length(key_suffix)=4));
update public.group_ai_settings set status='approved',enabled=false,revision=revision+1 where status='requested';
create or replace function public.request_group_ai(g uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not(public.is_group_admin(g) or public.is_super_admin()) then raise exception 'Chỉ admin được cấu hình AI';end if;
 insert into public.group_ai_settings(group_id,status,enabled,request_reason,requested_by) values(g,'approved',false,coalesce(nullif(trim(reason),''),'Khởi tạo cấu hình AI'),auth.uid()) on conflict do nothing;
end $$;

create or replace function public.configure_group_ai(g uuid,expected_revision bigint,configuration jsonb,envelope jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s public.group_ai_settings; decision text:=configuration->>'status'; active boolean:=coalesce((configuration->>'enabled')::boolean,false);
begin
 if not(public.is_group_admin(g) or public.is_super_admin()) then raise exception 'Chỉ admin được cấu hình AI';end if;
 perform pg_advisory_xact_lock(hashtextextended('ai-settings:'||g,0));
 select * into s from public.group_ai_settings where group_id=g for update;
 if (found and s.revision is distinct from expected_revision) or (not found and expected_revision is distinct from -1::bigint) then raise exception 'Cấu hình đã thay đổi';end if;
 if decision not in ('approved','revoked') or decision is null or coalesce(length(trim(configuration->>'reason')),0) not between 1 and 500 then raise exception 'Cần trạng thái và lý do';end if;
 if configuration->>'provider' not in ('google','anthropic','openai-compatible') or coalesce(length(configuration->>'model'),0) not between 1 and 120 then raise exception 'Cấu hình provider không hợp lệ';end if;
 if envelope is not null then
  if jsonb_typeof(envelope)<>'object' or not(envelope ?& array['iv','tag','ciphertext','version']) or envelope->>'version'<>'1' or length(envelope::text)>20000 or coalesce(length(configuration->>'suffix'),0)<>4 then raise exception 'Key mã hóa không hợp lệ';end if;
  insert into app_private.ai_credentials(group_id,envelope) values(g,envelope) on conflict(group_id) do update set envelope=excluded.envelope;
 end if;
 if decision='revoked' then delete from app_private.ai_credentials where group_id=g;active:=false;end if;
 if active and not exists(select 1 from app_private.ai_credentials where group_id=g) then raise exception 'Cần API key riêng cho nhóm';end if;
 insert into public.group_ai_settings(group_id,status,enabled,provider,model,base_url,key_suffix,message_limit,token_limit,request_reason,requested_by,decision_reason,decided_by,revision)
 values(g,decision,active,configuration->>'provider',configuration->>'model',nullif(configuration->>'base_url',''),case when decision='revoked' then null else nullif(configuration->>'suffix','') end,(configuration->>'message_limit')::integer,(configuration->>'token_limit')::integer,'Admin cấu hình trực tiếp',auth.uid(),trim(configuration->>'reason'),auth.uid(),0)
 on conflict(group_id) do update set status=excluded.status,enabled=excluded.enabled,provider=excluded.provider,model=excluded.model,base_url=excluded.base_url,key_suffix=excluded.key_suffix,message_limit=excluded.message_limit,token_limit=excluded.token_limit,decision_reason=excluded.decision_reason,decided_by=auth.uid(),revision=public.group_ai_settings.revision+1;
 insert into public.audit_log(group_id,actor_id,action,payload) values(g,auth.uid(),'ai_configured',jsonb_build_object('enabled',active,'reason',configuration->>'reason'));
end $$;

create function public.set_group_ai_enabled(g uuid,expected_revision bigint,enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare s public.group_ai_settings;
begin
 if not(public.is_group_admin(g) or public.is_super_admin()) then raise exception 'Chỉ admin được bật tắt AI';end if;
 select * into s from public.group_ai_settings where group_id=g for update;
 if not found or expected_revision is distinct from s.revision or enabled is null then raise exception 'Cấu hình đã thay đổi';end if;
 if enabled and (s.provider is null or s.model is null or not exists(select 1 from app_private.ai_credentials where group_id=g)) then raise exception 'Cần cấu hình provider và key trước';end if;
 update public.group_ai_settings set status=case when set_group_ai_enabled.enabled then 'approved' else status end,enabled=set_group_ai_enabled.enabled,revision=revision+1,decided_by=auth.uid() where group_id=g;
 insert into public.audit_log(group_id,actor_id,action,payload) values(g,auth.uid(),case when enabled then 'ai_enabled' else 'ai_disabled' end,jsonb_build_object('enabled',enabled));
end $$;
revoke all on function public.set_group_ai_enabled(uuid,bigint,boolean) from public,anon,service_role;
grant execute on function public.set_group_ai_enabled(uuid,bigint,boolean) to authenticated;

create or replace function public.configure_group_decisions(g uuid,expected_revision bigint,model_id text,reason text) returns void language plpgsql security definer set search_path='' as $$
declare s public.group_ai_settings;
begin
 if not(public.is_group_admin(g) or public.is_super_admin()) then raise exception 'Chỉ admin được cấu hình';end if;
 select * into s from public.group_ai_settings where group_id=g for update;
 if not found or s.revision is distinct from expected_revision or s.status is distinct from 'approved' or s.enabled is distinct from true or s.provider is distinct from 'openai-compatible' or s.base_url is distinct from 'https://openrouter.ai/api/v1' then raise exception 'Nhóm chưa bật OpenRouter hoặc cấu hình đã đổi';end if;
 if coalesce(length(trim(reason)),0) not between 1 and 500 then raise exception 'Cần lý do';end if;
 update public.group_ai_settings set decision_model=model_id,revision=revision+1 where group_id=g;
 insert into public.audit_log(group_id,actor_id,action,payload) values(g,auth.uid(),'ai_decision_routing_configured',jsonb_build_object('model',model_id,'reason',trim(reason)));
end $$;

-- Retain old poll data as history; no UI, AI or stale RPC may start/vote/convert polls.
insert into public.audit_log(group_id,action,payload) select group_id,'polls_retired',jsonb_build_object('count',count(*)) from public.polls where status='open' group by group_id;
update public.polls set status='closed' where status='open';
update public.notifications set href='/sessions' where href like '/polls/%';
create or replace function public.create_poll(g uuid,title_text text,venue_text text,minimum integer,deadline timestamptz,options jsonb) returns uuid language plpgsql security definer set search_path='' as $$begin raise exception 'Tính năng Hẹn lịch đã được gỡ. Hãy tạo buổi trong Buổi chơi';end$$;
create or replace function public.vote_poll(target uuid,response text) returns void language plpgsql security definer set search_path='' as $$begin raise exception 'Tính năng Hẹn lịch đã được gỡ';end$$;
create or replace function public.finish_poll(target uuid) returns void language plpgsql security definer set search_path='' as $$begin raise exception 'Tính năng Hẹn lịch đã được gỡ';end$$;
create or replace function public.close_poll(target uuid,chosen uuid) returns uuid language plpgsql security definer set search_path='' as $$begin raise exception 'Tính năng Hẹn lịch đã được gỡ';end$$;
create or replace function public.schedule_poll_meeting(request_key uuid,target_poll uuid,chosen_option uuid,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'Tính năng Hẹn lịch đã được gỡ';end$$;
alter function public.schedule_calendar_meeting(uuid,jsonb,uuid,uuid) rename to schedule_calendar_before_poll_retirement;
do $$begin execute replace(pg_get_functiondef('public.schedule_calendar_before_poll_retirement(uuid,jsonb,uuid,uuid)'::regprocedure),'schedule_calendar_meeting.request_key','schedule_calendar_before_poll_retirement.request_key');end$$;
revoke all on function public.schedule_calendar_before_poll_retirement(uuid,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
create function public.schedule_calendar_meeting(request_key uuid,body jsonb,source_poll uuid default null,chosen_option uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if source_poll is not null or chosen_option is not null then raise exception 'Tính năng Hẹn lịch đã được gỡ';end if;
 return public.schedule_calendar_before_poll_retirement(request_key,body,null,null);
end$$;
revoke all on function public.schedule_calendar_meeting(uuid,jsonb,uuid,uuid) from public,anon,service_role;
grant execute on function public.schedule_calendar_meeting(uuid,jsonb,uuid,uuid) to authenticated;

alter function public.create_ai_draft(uuid,text,jsonb) rename to create_ai_draft_before_retirement;
do $$begin execute replace(pg_get_functiondef('public.create_ai_draft_before_retirement(uuid,text,jsonb)'::regprocedure),'create_ai_draft.','create_ai_draft_before_retirement.');end$$;
revoke all on function public.create_ai_draft_before_retirement(uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.create_ai_draft(g uuid,command text,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if command in ('create_poll','vote') then raise exception 'Tính năng Hẹn lịch đã được gỡ';end if;
 if exists(select 1 from public.sessions where id=(body->>'sid')::uuid and deleted_at is not null) then raise exception 'Buổi đã xóa';end if;
 return public.create_ai_draft_before_retirement(g,command,body);
end$$;
revoke all on function public.create_ai_draft(uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.create_ai_draft(uuid,text,jsonb) to authenticated;
update public.ai_drafts set expires_at=least(expires_at,now()) where status='pending' and command in ('create_poll','vote');
