-- Invitation-scoped onboarding: verified identity and an active invitation are required.
create function public.invite_details(hashed_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i public.invites; result jsonb;
begin
 if not exists(select 1 from auth.users where id=auth.uid() and email is not null and email_confirmed_at is not null) then raise exception 'Vui lòng xác nhận email trước'; end if;
 select * into i from public.invites where token_hash=hashed_token;
 if not found or i.revoked_at is not null or i.expires_at<=now()
   or (i.uses>=i.max_uses and not public.is_member(i.group_id)) then raise exception 'Link mời không còn hiệu lực'; end if;
 if exists(select 1 from public.group_members where group_id=i.group_id and user_id=auth.uid() and status='removed') then raise exception 'Bạn đã được gỡ khỏi nhóm'; end if;
 select jsonb_build_object('group_id',g.id,'group_name',g.name,
   'guests',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.display_name) order by m.display_name,m.id) from public.group_members m where m.group_id=g.id and m.status='active' and m.user_id is null),'[]'::jsonb))
 into result from public.groups g where g.id=i.group_id;
 return result;
end $$;
revoke all on function public.invite_details(text) from public,anon;
grant execute on function public.invite_details(text) to authenticated;

create or replace function public.request_member_claim(target uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.group_members; body jsonb; g uuid;
begin
 if not exists(select 1 from auth.users where id=auth.uid() and email is not null and email_confirmed_at is not null) then raise exception 'Vui lòng xác nhận email trước'; end if;
 select group_id into g from public.group_members where id=target;
 if g is null or not public.is_member(g) then raise exception 'Không thể nhận thành viên này'; end if;
 perform 1 from public.groups where id=g for update;
 if not public.is_member(g) then raise exception 'Không thể nhận thành viên này'; end if;
 select * into m from public.group_members where id=target and group_id=g for update;
 if not found or m.user_id is not null or m.status<>'active' then raise exception 'Không thể nhận thành viên này'; end if;
 if exists(select 1 from public.group_members where group_id=g and user_id=auth.uid() and status='active' and role='admin') then raise exception 'Hãy chuyển quyền admin trước khi nhận thành viên'; end if;
 update public.approval_requests set status='expired' where requested_by=auth.uid() and group_id=g and type='member_claim' and status='pending' and expires_at<=now();
 if exists(select 1 from public.approval_requests where requested_by=auth.uid() and group_id=g and type='member_claim' and status='pending' and payload->>'member_id'=target::text) then return; end if;
 if (select count(*) from public.approval_requests where requested_by=auth.uid() and type='member_claim' and created_at>now()-interval '24 hours')>=10 then raise exception 'Bạn đã gửi quá nhiều yêu cầu xác minh. Vui lòng thử lại ngày mai'; end if;
 body:=jsonb_build_object('member_id',m.id);
 insert into public.approval_requests(group_id,type,payload,payload_hash,required_authority,requested_by) values(g,'member_claim',body,encode(sha256(convert_to(body::text,'UTF8')),'hex'),'group_admin',auth.uid());
 insert into public.audit_log(group_id,actor_id,action,payload) values(g,auth.uid(),'member_claim_requested',body);
end $$;

create function public.accept_invite_with_claim(hashed_token text,member_name text,claim_member uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare g uuid; invitation public.invites;
begin
 if not exists(select 1 from auth.users where id=auth.uid() and email is not null and email_confirmed_at is not null) then raise exception 'Vui lòng xác nhận email trước'; end if;
 -- Invite first, group second: preserve accept_invite's lock order.
 select * into invitation from public.invites where token_hash=hashed_token for update;
 if not found or invitation.revoked_at is not null or invitation.expires_at<=now() then raise exception 'Link mời không còn hiệu lực'; end if;
 -- A retry after the last invite use must not consume another use.
 if public.is_member(invitation.group_id) then
   if claim_member is not null then
     if exists(select 1 from public.group_members where id=claim_member and group_id=invitation.group_id and user_id=auth.uid() and status='active') then return invitation.group_id; end if;
     if not exists(select 1 from public.group_members where id=claim_member and group_id=invitation.group_id and user_id is null and status='active') then raise exception 'Tên cũ không thuộc nhóm hoặc đã được liên kết'; end if;
     perform public.request_member_claim(claim_member);
   end if;
   return invitation.group_id;
 end if;
 if claim_member is not null and not exists(select 1 from public.group_members where id=claim_member and group_id=invitation.group_id and user_id is null and status='active') then raise exception 'Tên cũ không thuộc nhóm hoặc đã được liên kết'; end if;
 g:=public.accept_invite(hashed_token,member_name);
 if claim_member is not null then perform public.request_member_claim(claim_member); end if;
 return g;
end $$;
revoke all on function public.accept_invite_with_claim(text,text,uuid) from public,anon;
grant execute on function public.accept_invite_with_claim(text,text,uuid) to authenticated;

-- Do not put private emails in payloads readable by the whole group.
create function public.member_claim_reviews(g uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_group_admin(g) then raise exception 'Chỉ admin nhóm được xem'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'member_id',r.payload->>'member_id','email',u.email,'email_verified',u.email_confirmed_at is not null) order by r.created_at)
 from public.approval_requests r join auth.users u on u.id=r.requested_by
 where r.group_id=g and r.type='member_claim' and r.status='pending' and r.expires_at>now()),'[]'::jsonb);
end $$;
revoke all on function public.member_claim_reviews(uuid) from public,anon;
grant execute on function public.member_claim_reviews(uuid) to authenticated;


-- Recheck verified email at approval; preserve the original history safeguards.
create or replace function public.decide_member_claim(request_id uuid, approve boolean) returns void language plpgsql security definer set search_path='' as $$
declare r public.approval_requests; target public.group_members; current_member public.group_members;
begin
 select * into r from public.approval_requests where id=request_id;
 if not found or not public.is_group_admin(r.group_id) then raise exception 'Chỉ admin nhóm được duyệt'; end if;
 perform 1 from public.groups where id=r.group_id for update;
 if not public.is_group_admin(r.group_id) then raise exception 'Chỉ admin nhóm được duyệt'; end if;
 select * into r from public.approval_requests where id=request_id for update;
 if r.type<>'member_claim' or r.status<>'pending' or r.expires_at<=now() or r.payload_hash<>encode(sha256(convert_to(r.payload::text,'UTF8')),'hex') then raise exception 'Yêu cầu đã thay đổi hoặc hết hạn'; end if;
 if approve then
 if not exists(select 1 from auth.users where id=r.requested_by and email is not null and email_confirmed_at is not null) then raise exception 'Email người yêu cầu chưa được xác nhận'; end if;
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
