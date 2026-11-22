create or replace function public.accept_invite(hashed_token text, member_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare invitation public.invites; member public.group_members;
begin
 if auth.uid() is null then raise exception 'Vui lòng đăng nhập';end if;
 if member_name is null or length(trim(member_name)) not between 1 and 100 then raise exception 'Tên không hợp lệ';end if;
 select * into invitation from public.invites where token_hash=hashed_token for update;
 if not found or invitation.revoked_at is not null or invitation.expires_at<=now() then raise exception 'Link mời đã hết hạn, hết lượt hoặc bị thu hồi';end if;
 select * into member from public.group_members where group_id=invitation.group_id and user_id=auth.uid();
 if found then
  if member.status='active' then return invitation.group_id;end if;
  raise exception 'Bạn đã được gỡ khỏi nhóm. Vui lòng liên hệ admin';
 end if;
 if invitation.uses>=invitation.max_uses then raise exception 'Link mời đã hết hạn, hết lượt hoặc bị thu hồi';end if;
 insert into public.group_members(group_id,user_id,display_name) values(invitation.group_id,auth.uid(),trim(member_name));
 update public.invites set uses=uses+1 where id=invitation.id;
 insert into public.audit_log(group_id,actor_id,action) values(invitation.group_id,auth.uid(),'member_joined');
 return invitation.group_id;
end $$;
revoke all on function public.accept_invite(text,text) from public,anon;
grant execute on function public.accept_invite(text,text) to authenticated;
