create table public.approval_requests (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references public.groups,
 session_id uuid references public.sessions, type text not null, payload jsonb not null,
 payload_hash text not null, required_authority text not null, requested_by uuid not null references auth.users,
 source text not null default 'app' check(source in ('app','ai')),
 status text not null default 'pending' check(status in ('pending','approved','rejected','expired','cancelled')),
 decided_by uuid references auth.users, decided_at timestamptz, decision_note text,
 expires_at timestamptz not null default now()+interval '72 hours',created_at timestamptz not null default now()
);
alter table public.approval_requests enable row level security;
create policy approvals_read on public.approval_requests for select to authenticated using(public.is_member(group_id));
grant select on public.approval_requests to authenticated;
revoke insert,update,delete on public.approval_requests from anon,authenticated;
create unique index pending_member_claim on public.approval_requests(requested_by,group_id) where type='member_claim' and status='pending';

create function public.request_member_claim(target uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.group_members; body jsonb;
begin
 select * into m from public.group_members where id=target;
 if not found or m.user_id is not null or m.status<>'active' or not public.is_member(m.group_id) then raise exception 'Không thể nhận thành viên này'; end if;
 perform 1 from public.groups where id=m.group_id for update;
 if (select count(*) from public.approval_requests where requested_by=auth.uid() and type='member_claim' and created_at>now()-interval '24 hours')>=10 then raise exception 'Bạn đã gửi quá nhiều yêu cầu xác minh. Vui lòng thử lại ngày mai'; end if;
 update public.approval_requests set status='expired' where requested_by=auth.uid() and group_id=m.group_id and type='member_claim' and status='pending' and expires_at<=now();
 body:=jsonb_build_object('member_id',m.id);
 insert into public.approval_requests(group_id,type,payload,payload_hash,required_authority,requested_by) values(m.group_id,'member_claim',body,encode(sha256(convert_to(body::text,'UTF8')),'hex'),'group_admin',auth.uid());
 insert into public.audit_log(group_id,actor_id,action,payload) values(m.group_id,auth.uid(),'member_claim_requested',body);
end $$;

create function public.decide_member_claim(request_id uuid, approve boolean) returns void language plpgsql security definer set search_path='' as $$
declare r public.approval_requests; target public.group_members; current_member public.group_members;
begin
 select * into r from public.approval_requests where id=request_id;
 if not found or not public.is_group_admin(r.group_id) then raise exception 'Chỉ admin nhóm được duyệt'; end if;
 perform 1 from public.groups where id=r.group_id for update;
 select * into r from public.approval_requests where id=request_id for update;
 if r.type<>'member_claim' or r.status<>'pending' or r.expires_at<=now() or r.payload_hash<>encode(sha256(convert_to(r.payload::text,'UTF8')),'hex') then raise exception 'Yêu cầu đã thay đổi hoặc hết hạn'; end if;
 if approve then
 select * into target from public.group_members where id=(r.payload->>'member_id')::uuid and group_id=r.group_id and user_id is null and status='active' for update;
 if not found then raise exception 'Thành viên đã được nhận hoặc bị gỡ'; end if;
 select * into current_member from public.group_members where user_id=r.requested_by and group_id=r.group_id and status='active' for update;
 if not found then raise exception 'Người yêu cầu không còn trong nhóm'; end if;
 if current_member.role='admin' then raise exception 'Hãy chuyển quyền admin trước khi nhận thành viên'; end if;
 if exists(select 1 from public.session_attendees where member_id=current_member.id)
 or exists(select 1 from public.expenses where paid_by=current_member.id)
 or exists(select 1 from public.expense_allocations where member_id=current_member.id)
 or exists(select 1 from public.settlements where from_member=current_member.id or to_member=current_member.id)
 or exists(select 1 from public.sessions where collector_member_id=current_member.id)
 or exists(select 1 from public.attendance_events where member_id=current_member.id)
 then raise exception 'Tài khoản mới đã có lịch sử buổi chơi; cần xử lý liên kết thủ công để bảo toàn dữ liệu'; end if;
 update public.group_members set user_id=null,status='removed' where id=current_member.id;
 update public.group_members set user_id=r.requested_by where id=target.id;
 end if;
 update public.approval_requests set status=case when approve then 'approved' else 'rejected' end,decided_by=auth.uid(),decided_at=now() where id=request_id;
 insert into public.audit_log(group_id,actor_id,action,payload) values(r.group_id,auth.uid(),case when approve then 'member_claim_approved' else 'member_claim_rejected' end,r.payload);
end $$;
revoke all on function public.request_member_claim(uuid),public.decide_member_claim(uuid,boolean) from public,anon;
grant execute on function public.request_member_claim(uuid),public.decide_member_claim(uuid,boolean) to authenticated;
