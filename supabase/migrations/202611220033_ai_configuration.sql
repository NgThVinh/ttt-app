create table public.group_ai_settings(group_id uuid primary key references public.groups,status text not null default 'requested' check(status in ('requested','approved','rejected','revoked')),enabled boolean not null default false,provider text check(provider in ('google','anthropic','openai-compatible')),model text,base_url text,key_suffix text,message_limit integer not null default 30 check(message_limit between 1 and 500),token_limit integer not null default 100000 check(token_limit between 1000 and 10000000),request_reason text not null,decision_reason text,requested_by uuid not null references auth.users,decided_by uuid references auth.users,revision bigint not null default 0,created_at timestamptz not null default now());
create table app_private.ai_credentials(group_id uuid primary key references public.groups,envelope jsonb not null,created_at timestamptz not null default now());
create table public.ai_runs(id uuid primary key default gen_random_uuid(),group_id uuid not null references public.groups,user_id uuid not null references auth.users,prompt_version text not null,reserved_tokens integer not null,actual_tokens integer,status text not null default 'running' check(status in ('running','succeeded','failed')),created_at timestamptz not null default now());
alter table public.group_ai_settings enable row level security;
alter table public.ai_runs enable row level security;
alter table app_private.ai_credentials enable row level security;
revoke all on public.group_ai_settings,public.ai_runs,app_private.ai_credentials from public,anon,authenticated,service_role;
grant select on public.group_ai_settings,public.ai_runs to authenticated;
create policy ai_settings_read on public.group_ai_settings for select to authenticated using(public.is_member(group_id) or public.is_super_admin());
create policy ai_runs_read on public.ai_runs for select to authenticated using((user_id=auth.uid() and public.is_member(group_id)) or public.is_super_admin());
create function public.request_group_ai(g uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_group_admin(g) or coalesce(length(trim(reason)),0) not between 1 and 500 then raise exception 'Không có quyền hoặc thiếu lý do';end if;
 perform pg_advisory_xact_lock(hashtextextended('ai-settings:'||g,0));
 if exists(select 1 from public.group_ai_settings where group_id=g and status in ('requested','approved')) then raise exception 'Nhóm đã gửi yêu cầu hoặc đã được duyệt';end if;
 insert into public.group_ai_settings(group_id,request_reason,requested_by) values(g,trim(reason),auth.uid()) on conflict(group_id) do update set status='requested',enabled=false,request_reason=excluded.request_reason,requested_by=excluded.requested_by,revision=public.group_ai_settings.revision+1;
end $$;
create function public.configure_group_ai(g uuid,expected_revision bigint,configuration jsonb,envelope jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s public.group_ai_settings;decision text:=configuration->>'status';
begin
 if not public.is_super_admin() then raise exception 'Chỉ super admin được cấu hình AI';end if;
 select * into s from public.group_ai_settings where group_id=g for update;
 if not found or s.revision<>expected_revision then raise exception 'Cấu hình đã thay đổi';end if;
 if decision is null or decision not in ('approved','rejected','revoked') or coalesce(length(trim(configuration->>'reason')),0) not between 1 and 500 then raise exception 'Cần quyết định và lý do';end if;
 if decision='approved' then
  if configuration->>'provider' not in ('google','anthropic','openai-compatible') or coalesce(length(configuration->>'model'),0) not between 1 and 120 or coalesce(length(configuration->>'suffix'),0)<>4 then raise exception 'Cấu hình provider không hợp lệ';end if;
  if envelope is not null then
   if jsonb_typeof(envelope)<>'object' or not(envelope ?& array['iv','tag','ciphertext','version']) or envelope->>'version'<>'1' or length(envelope::text)>20000 then raise exception 'Key mã hóa không hợp lệ';end if;
   insert into app_private.ai_credentials(group_id,envelope) values(g,envelope) on conflict(group_id) do update set envelope=excluded.envelope;
  end if;
  if not exists(select 1 from app_private.ai_credentials where group_id=g) then raise exception 'Cần API key riêng cho nhóm';end if;
 else delete from app_private.ai_credentials where group_id=g;end if;
 update public.group_ai_settings set status=decision,enabled=decision='approved' and coalesce((configuration->>'enabled')::boolean,false),provider=configuration->>'provider',model=configuration->>'model',base_url=nullif(configuration->>'base_url',''),key_suffix=case when decision='approved' then configuration->>'suffix' else null end,message_limit=(configuration->>'message_limit')::integer,token_limit=(configuration->>'token_limit')::integer,decision_reason=trim(configuration->>'reason'),decided_by=auth.uid(),revision=revision+1 where group_id=g;
 insert into public.audit_log(group_id,actor_id,action,payload) values(g,auth.uid(),'ai_configured',jsonb_build_object('status',decision,'reason',configuration->>'reason'));
end $$;
create function public.read_ai_credential(g uuid) returns jsonb language sql stable security definer set search_path='' as $$ select c.envelope from app_private.ai_credentials c join public.group_ai_settings s on s.group_id=c.group_id where c.group_id=g and s.enabled and s.status='approved' $$;
revoke all on function public.read_ai_credential(uuid) from public,anon,authenticated;
grant execute on function public.read_ai_credential(uuid) to service_role;
create function public.reserve_ai_run(g uuid,prompt_version text,budget integer) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.group_ai_settings;rid uuid;
begin
 if not public.is_member(g) or budget is null or budget not between 1000 and 20000 or prompt_version is null or length(prompt_version)>80 then raise exception 'Không có quyền';end if;
 select * into s from public.group_ai_settings where group_id=g for update;
 if not found or s.status<>'approved' or not s.enabled then raise exception 'Nhóm chưa bật AI';end if;
 if(select count(*) from public.ai_runs where group_id=g and user_id=auth.uid() and created_at>=(date_trunc('day',now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'))>=s.message_limit then raise exception 'Đã hết hạn mức tin nhắn hôm nay';end if;
 if(select coalesce(sum(case when status='running' then reserved_tokens else coalesce(actual_tokens,reserved_tokens) end),0) from public.ai_runs where group_id=g and created_at>=(date_trunc('day',now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'))+budget>s.token_limit then raise exception 'Nhóm đã hết hạn mức token';end if;
 if(select count(*) from public.ai_runs where group_id=g and status='failed' and created_at>now()-interval '5 minutes')>=3 then raise exception 'AI tạm nghỉ do provider lỗi; thử lại sau';end if;
 if exists(select 1 from public.ai_runs where group_id=g and user_id=auth.uid() and created_at>now()-interval '3 seconds') then raise exception 'Vui lòng chờ vài giây';end if;
 insert into public.ai_runs(group_id,user_id,prompt_version,reserved_tokens) values(g,auth.uid(),prompt_version,budget) returning id into rid;return rid;
end $$;
create function public.finish_ai_run(target uuid,tokens integer,succeeded boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if tokens is null or tokens<0 then raise exception 'Usage không hợp lệ';end if;
 update public.ai_runs set status=case when succeeded then 'succeeded' else 'failed' end,actual_tokens=tokens where id=target and status='running';
end $$;
revoke all on function public.finish_ai_run(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.finish_ai_run(uuid,integer,boolean) to service_role;
revoke all on function public.request_group_ai(uuid,text),public.configure_group_ai(uuid,bigint,jsonb,jsonb),public.reserve_ai_run(uuid,text,integer) from public,anon,service_role;
grant execute on function public.request_group_ai(uuid,text),public.configure_group_ai(uuid,bigint,jsonb,jsonb),public.reserve_ai_run(uuid,text,integer) to authenticated;
