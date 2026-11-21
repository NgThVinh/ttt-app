create table public.profiles (
 id uuid primary key references auth.users, display_name text not null check(length(trim(display_name)) between 1 and 100),
 avatar_url text, bank_bin text, bank_account_no text, bank_account_name text,
 created_at timestamptz not null default now(),
 constraint valid_bank_details check(
 (coalesce(bank_bin,'')='' and coalesce(bank_account_no,'')='' and coalesce(bank_account_name,'')='')
 or (bank_bin ~ '^[0-9]{6}$' and bank_account_no ~ '^[A-Za-z0-9]{4,30}$' and length(trim(bank_account_name)) between 1 and 100
 and bank_bin is not null and bank_account_no is not null and bank_account_name is not null))
);
alter table public.profiles enable row level security;
create policy profile_self_read on public.profiles for select to authenticated using(id=auth.uid());
create policy profile_self_insert on public.profiles for insert to authenticated with check(id=auth.uid());
create policy profile_self_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
grant select,insert,update on public.profiles to authenticated;
revoke delete on public.profiles from authenticated,anon;

create table public.invites (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references public.groups,
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null, max_uses integer not null check(max_uses between 1 and 100),
 uses integer not null default 0 check(uses>=0 and uses<=max_uses), revoked_at timestamptz,
 created_by uuid not null references auth.users, created_at timestamptz not null default now()
);
alter table public.invites enable row level security;
create function public.is_group_admin(g uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.group_members where group_id=g and user_id=auth.uid() and role='admin' and status='active')
$$;
create policy invite_admin_read on public.invites for select to authenticated using(public.is_group_admin(group_id));
grant select on public.groups,public.group_members,public.sessions,public.audit_log,public.invites to authenticated;
revoke insert,update,delete on public.invites from anon,authenticated;

-- This RPC is server-internal. The app checks the verified user's email against
-- SUPER_ADMIN_EMAILS before calling it. User/AI clients have no execution grant.
create function public.provision_group(owner_id uuid, group_name text, group_sport text) returns uuid
 language plpgsql security definer set search_path='' as $$
declare g uuid; label text;
begin
 if not exists(select 1 from auth.users where id=owner_id and email_confirmed_at is not null) then raise exception 'Tài khoản chưa xác minh'; end if;
 if length(trim(group_name)) not between 1 and 100 or length(trim(group_sport)) not between 1 and 60 then raise exception 'Thông tin nhóm không hợp lệ'; end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),split_part(email,'@',1)) into label from auth.users where id=owner_id;
 insert into public.groups(name,sport,created_by) values(trim(group_name),trim(group_sport),owner_id) returning id into g;
 insert into public.group_members(group_id,user_id,display_name,role) values(g,owner_id,left(label,100),'admin');
 insert into public.audit_log(group_id,actor_id,action) values(g,owner_id,'group_created');
 return g;
end $$;

create function public.create_invite(g uuid, hashed_token text, valid_until timestamptz, use_limit integer) returns uuid
 language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform 1 from public.groups where id=g for update;
 if not public.is_group_admin(g) then raise exception 'Chỉ admin nhóm tạo được link mời'; end if;
 if valid_until<=now() or valid_until>now()+interval '30 days' or use_limit not between 1 and 100 then raise exception 'Giới hạn link mời không hợp lệ'; end if;
 if (select count(*) from public.invites where group_id=g and created_at>now()-interval '1 hour')>=20 then raise exception 'Bạn đã tạo quá nhiều link mời. Vui lòng thử sau'; end if;
 insert into public.invites(group_id,token_hash,expires_at,max_uses,created_by) values(g,hashed_token,valid_until,use_limit,auth.uid()) returning id into result;
 insert into public.audit_log(group_id,actor_id,action,payload) values(g,auth.uid(),'invite_created',jsonb_build_object('invite_id',result));
 return result;
end $$;

create function public.revoke_invite(target uuid) returns void language plpgsql security definer set search_path='' as $$
declare g uuid;
begin
 select group_id into g from public.invites where id=target;
 if not public.is_group_admin(g) then raise exception 'Không có quyền thu hồi link mời'; end if;
 update public.invites set revoked_at=coalesce(revoked_at,now()) where id=target;
 insert into public.audit_log(group_id,actor_id,action,payload) values(g,auth.uid(),'invite_revoked',jsonb_build_object('invite_id',target));
end $$;

create function public.accept_invite(hashed_token text, member_name text) returns uuid
 language plpgsql security definer set search_path='' as $$
declare invitation public.invites; member public.group_members;
begin
 if auth.uid() is null then raise exception 'Vui lòng đăng nhập'; end if;
 if length(trim(member_name)) not between 1 and 100 then raise exception 'Tên không hợp lệ'; end if;
 select * into invitation from public.invites where token_hash=hashed_token for update;
 if not found or invitation.revoked_at is not null or invitation.expires_at<=now() or invitation.uses>=invitation.max_uses then raise exception 'Link mời đã hết hạn, hết lượt hoặc bị thu hồi'; end if;
 select * into member from public.group_members where group_id=invitation.group_id and user_id=auth.uid();
 if found then
   if member.status='active' then return invitation.group_id; end if;
   raise exception 'Bạn đã được gỡ khỏi nhóm. Vui lòng liên hệ admin';
 end if;
 insert into public.group_members(group_id,user_id,display_name) values(invitation.group_id,auth.uid(),trim(member_name));
 update public.invites set uses=uses+1 where id=invitation.id;
 insert into public.audit_log(group_id,actor_id,action) values(invitation.group_id,auth.uid(),'member_joined');
 return invitation.group_id;
end $$;

create function public.manage_member(g uuid, target uuid, operation text, label text default null) returns void
 language plpgsql security definer set search_path='' as $$
declare m public.group_members;
begin
 perform 1 from public.groups where id=g for update;
 if not public.is_group_admin(g) then raise exception 'Chỉ admin nhóm quản lý được thành viên'; end if;
 if operation='add' then
   if label is null or length(trim(label)) not between 1 and 100 then raise exception 'Tên không hợp lệ'; end if;
   insert into public.group_members(group_id,display_name) values(g,trim(label));
 else
   select * into m from public.group_members where id=target and group_id=g and status='active' for update;
   if not found then raise exception 'Thành viên không tồn tại'; end if;
   if operation not in ('remove','admin','member') then raise exception 'Thao tác không hợp lệ'; end if;
   if operation='admin' and m.user_id is null then raise exception 'Thành viên cần có tài khoản trước khi làm admin'; end if;
   if m.role='admin' and operation in ('remove','member') and (select count(*) from public.group_members where group_id=g and role='admin' and status='active')<=1 then raise exception 'Nhóm phải còn ít nhất một admin'; end if;
   update public.group_members set status=case when operation='remove' then 'removed' else status end, role=case when operation in ('admin','member') then operation else role end where id=target;
 end if;
 insert into public.audit_log(group_id,actor_id,action,payload) values(g,auth.uid(),'member_'||operation,jsonb_build_object('member_id',target));
end $$;
revoke all on function public.provision_group(uuid,text,text) from public,anon,authenticated;
grant execute on function public.provision_group(uuid,text,text) to service_role;
revoke all on function public.is_group_admin(uuid),public.create_invite(uuid,text,timestamptz,integer),public.revoke_invite(uuid),public.accept_invite(text,text),public.manage_member(uuid,uuid,text,text) from public,anon;
grant execute on function public.is_group_admin(uuid),public.create_invite(uuid,text,timestamptz,integer),public.revoke_invite(uuid),public.accept_invite(text,text),public.manage_member(uuid,uuid,text,text) to authenticated;
create index members_user_active on public.group_members(user_id,group_id) where status='active';
create index invites_group on public.invites(group_id);
