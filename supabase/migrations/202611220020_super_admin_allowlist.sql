create schema if not exists app_private;
revoke all on schema app_private from public,anon,authenticated,service_role;

create table app_private.super_admin_allowlist (
 email text primary key check(email=lower(trim(email)) and length(email) between 3 and 254),
 active boolean not null default true,
 synced_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create table app_private.group_creation_requests (
 actor_id uuid not null references auth.users,
 request_key uuid not null,
 payload_hash text not null,
 group_id uuid not null references public.groups,
 created_at timestamptz not null default now(),
 primary key(actor_id,request_key)
);
alter table app_private.super_admin_allowlist enable row level security;
alter table app_private.group_creation_requests enable row level security;
revoke all on app_private.super_admin_allowlist,app_private.group_creation_requests from public,anon,authenticated,service_role;

-- User-facing functions derive authority from the current verified Auth row,
-- never from editable profile metadata or a caller-supplied owner ID.
create function public.is_super_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join app_private.super_admin_allowlist a on a.email=lower(trim(u.email)) and a.active where u.id=auth.uid() and u.email_confirmed_at is not null)
$$;
revoke all on function public.is_super_admin() from public,anon,service_role;
grant execute on function public.is_super_admin() to authenticated;

-- Retain the existing fixture/provisioning helper only for the database owner.
-- Runtime clients, including service_role, must not provision arbitrary owners.
revoke all on function public.provision_group(uuid,text,text) from public,anon,authenticated,service_role;

create function public.create_group(group_name text,group_sport text,request_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_email text; fingerprint text; previous app_private.group_creation_requests; result uuid;
begin
 select lower(trim(email)) into actor_email from auth.users where id=actor and email_confirmed_at is not null for share;
 if actor_email is null then raise exception 'Tài khoản chưa xác minh'; end if;
 perform 1 from app_private.super_admin_allowlist where email=actor_email and active for share;
 if not found then raise exception 'Chỉ super admin được tạo nhóm'; end if;
 if request_key is null or group_name is null or group_sport is null or length(trim(group_name)) not between 1 and 100 or length(trim(group_sport)) not between 1 and 60 then raise exception 'Thông tin nhóm không hợp lệ'; end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('name',trim(group_name),'sport',trim(group_sport))::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('3t-create-group:'||actor||':'||request_key,0));
 select * into previous from app_private.group_creation_requests r where r.actor_id=actor and r.request_key=create_group.request_key;
 if found then
  if previous.payload_hash<>fingerprint then raise exception 'Mã yêu cầu đã dùng cho nội dung khác'; end if;
  return previous.group_id;
 end if;
 result:=public.provision_group(actor,trim(group_name),trim(group_sport));
 insert into app_private.group_creation_requests(actor_id,request_key,payload_hash,group_id) values(actor,request_key,fingerprint,result);
 return result;
end $$;
revoke all on function public.create_group(text,text,uuid) from public,anon,service_role;
grant execute on function public.create_group(text,text,uuid) to authenticated;
