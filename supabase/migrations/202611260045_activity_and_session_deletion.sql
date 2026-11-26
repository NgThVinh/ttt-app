alter table public.sessions add column deleted_at timestamptz, add column deleted_by uuid references auth.users;
create policy sessions_not_deleted on public.sessions as restrictive for select to authenticated using(deleted_at is null);

create function public.delete_unfinalized_session(sid uuid,expected_revision bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.sessions;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 if s.deleted_at is not null then return s.id;end if;
 if expected_revision is null or s.revision<>expected_revision then raise exception 'Buổi đã thay đổi; hãy xem lại';end if;
 if s.status not in ('planned','cancelled') or s.costs_finalized_at is not null or exists(select 1 from public.expenses where session_id=sid and amount<>0) or exists(select 1 from public.settlements where session_id=sid) then raise exception 'Chỉ được xóa buổi chưa chốt chi phí';end if;
 update public.approval_requests set status='cancelled' where session_id=sid and status='pending';
 update public.sessions set deleted_at=now(),deleted_by=auth.uid(),status='cancelled',revision=revision+1 where id=sid;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,sid,auth.uid(),'session_deleted',jsonb_build_object('title',s.title,'starts_at',s.starts_at,'venue',s.venue));
 perform public.notify_group(s.group_id,'session-deleted:'||sid,'Đã xóa buổi chưa chốt: '||s.title,'/sessions');
 return sid;
end $$;
revoke all on function public.delete_unfinalized_session(uuid,bigint) from public,anon,service_role;
grant execute on function public.delete_unfinalized_session(uuid,bigint) to authenticated;

create function app_private.guard_deleted_session() returns trigger language plpgsql security definer set search_path='' as $$
declare sid uuid; row_data jsonb;
begin
 if tg_table_name='sessions' then
  if old.deleted_at is not null then raise exception 'Buổi đã xóa';end if;
 else
  row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  sid:=(row_data->>'session_id')::uuid;
  if sid is null and row_data ? 'expense_id' then select session_id into sid from public.expenses where id=(row_data->>'expense_id')::uuid;end if;
  if sid is null and row_data ? 'settlement_id' then select session_id into sid from public.settlements where id=(row_data->>'settlement_id')::uuid;end if;
  if exists(select 1 from public.sessions where id=sid and deleted_at is not null) then raise exception 'Buổi đã xóa';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function app_private.guard_deleted_session() from public,anon,authenticated,service_role;
create trigger guard_deleted_session before update on public.sessions for each row execute function app_private.guard_deleted_session();
do $$declare t text;begin
 foreach t in array array['session_attendees','expenses','expense_allocations','settlements','approval_requests','expense_split_inputs','payment_evidence','expense_receipts'] loop
  if to_regclass('public.'||t) is not null then execute format('create trigger guard_deleted_session before insert or update or delete on public.%I for each row execute function app_private.guard_deleted_session()',t);end if;
 end loop;
end $$;
alter function public.session_details(uuid) rename to session_details_before_deletion;
revoke all on function public.session_details_before_deletion(uuid) from public,anon,authenticated,service_role;
create function public.session_details(sid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.sessions where id=sid and deleted_at is null and public.is_member(group_id)) then raise exception 'Không có quyền hoặc buổi đã xóa';end if;
 return public.session_details_before_deletion(sid);
end $$;
revoke all on function public.session_details(uuid) from public,anon,service_role;
grant execute on function public.session_details(uuid) to authenticated;

-- Audit data is system-written, immutable and scoped to group administrators.
alter table public.audit_log alter column group_id drop not null;
drop policy audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using(public.is_super_admin() or public.is_group_admin(group_id));
create index audit_admin_cursor on public.audit_log(created_at desc,id desc);
create index audit_group_cursor on public.audit_log(group_id,created_at desc,id desc);
create function public.can_view_audit() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (public.is_super_admin() or exists(select 1 from public.group_members where user_id=auth.uid() and role='admin' and status='active'))
$$;
revoke all on function public.can_view_audit() from public,anon,service_role;
grant execute on function public.can_view_audit() to authenticated;
create function public.audit_groups() returns table(id uuid,name text) language sql stable security definer set search_path='' as $$
 select g.id,g.name from public.groups g where public.is_super_admin() or public.is_group_admin(g.id) order by g.name,g.id
$$;
revoke all on function public.audit_groups() from public,anon,service_role;
grant execute on function public.audit_groups() to authenticated;

create function public.admin_audit_page(target_group uuid default null,before_time timestamptz default null,before_id uuid default null,page_size integer default 30) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.can_view_audit() or (target_group is not null and not(public.is_super_admin() or public.is_group_admin(target_group))) then raise exception 'Chỉ admin được xem audit log';end if;
 if (before_time is null)<>(before_id is null) then raise exception 'Cursor không hợp lệ';end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]') into result from (
  select a.id,a.created_at,a.group_id,g.name group_name,a.session_id,coalesce(s.title,a.payload->>'title') session_title,a.actor_id,
   coalesce(p.display_name,(select display_name from public.group_members where group_id=a.group_id and user_id=a.actor_id limit 1),case when a.actor_id is null then 'Hệ thống' else 'Thành viên' end) actor_name,
   a.action,a.payload
  from public.audit_log a left join public.groups g on g.id=a.group_id left join public.sessions s on s.id=a.session_id left join public.profiles p on p.id=a.actor_id
  where (public.is_super_admin() or public.is_group_admin(a.group_id)) and (target_group is null or a.group_id=target_group)
   and (before_time is null or (a.created_at,a.id)<(before_time,before_id))
  order by a.created_at desc,a.id desc limit greatest(1,least(coalesce(page_size,30),100))
 ) r;
 return result;
end $$;
revoke all on function public.admin_audit_page(uuid,timestamptz,uuid,integer) from public,anon,service_role;
grant execute on function public.admin_audit_page(uuid,timestamptz,uuid,integer) to authenticated;

-- Record every authenticated mutation without copying secrets, bank details or chat content.
create function app_private.audit_user_mutation() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb; previous jsonb; gid uuid; sid uuid; target text; fields jsonb; profile_group uuid;
begin
 if auth.uid() is null then if tg_op='DELETE' then return old;end if;return new;end if;
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 previous:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 if tg_op='UPDATE' and r=previous then return new;end if;
 select coalesce(jsonb_agg(k order by k),'[]') into fields from jsonb_object_keys(r) k where tg_op<>'UPDATE' or r->k is distinct from previous->k;
 gid:=(r->>'group_id')::uuid;sid:=(r->>'session_id')::uuid;target:=coalesce(r->>'id',concat_ws(':',r->>'session_id',r->>'member_id'));
 if tg_table_name='groups' then gid:=(r->>'id')::uuid;end if;
 if tg_table_name='sessions' then sid:=(r->>'id')::uuid;end if;
 if sid is null and r ? 'expense_id' then select session_id into sid from public.expenses where id=(r->>'expense_id')::uuid;end if;
 if sid is null and r ? 'settlement_id' then select session_id into sid from public.settlements where id=(r->>'settlement_id')::uuid;end if;
 if gid is null and sid is not null then select group_id into gid from public.sessions where id=sid;end if;
 if tg_table_name='profiles' then
  if not exists(select 1 from public.group_members where user_id=(r->>'id')::uuid and status='active') then
   insert into public.audit_log(actor_id,action,payload) values(auth.uid(),'profile_updated',jsonb_build_object('table',tg_table_name,'operation',tg_op,'record_id',target,'changed_fields',fields));
  end if;
  for profile_group in select distinct group_id from public.group_members where user_id=(r->>'id')::uuid and status='active' loop
   insert into public.audit_log(group_id,actor_id,action,payload) values(profile_group,auth.uid(),'profile_updated',jsonb_build_object('table',tg_table_name,'operation',tg_op,'record_id',target,'changed_fields',fields));
  end loop;
 else
  insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(gid,sid,auth.uid(),'data_'||lower(tg_op),jsonb_build_object('table',tg_table_name,'operation',tg_op,'record_id',target,'changed_fields',fields));
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function app_private.audit_user_mutation() from public,anon,authenticated,service_role;
do $$declare t text;begin
 foreach t in array array['groups','group_members','profiles','invites','sessions','session_attendees','expenses','expense_allocations','settlements','approval_requests','notifications','group_ai_settings','ai_runs','ai_drafts','group_expense_categories','expense_templates','weekly_series','payment_evidence','expense_receipts','push_subscriptions'] loop
  if to_regclass('public.'||t) is not null then execute format('create trigger audit_user_mutation after insert or update or delete on public.%I for each row execute function app_private.audit_user_mutation()',t);end if;
 end loop;
end $$;
