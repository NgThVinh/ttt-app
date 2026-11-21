create or replace function public.payment_action(target uuid,operation text) returns void language plpgsql security definer set search_path='' as $$
declare pay public.settlements;s public.sessions;actor uuid;
begin
 select session.* into s from public.sessions session join public.settlements p on p.session_id=session.id where p.id=target for update of session;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 select * into pay from public.settlements where id=target for update;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 if (operation='mark' and actor=pay.from_member and pay.status='marked_paid') or (operation='confirm' and actor=pay.to_member and pay.status='confirmed') then return;end if;
 if operation='mark' and actor=pay.from_member and pay.status='pending' then update public.settlements set status='marked_paid',marked_paid_at=now() where id=target;
 elsif operation='confirm' and actor=pay.to_member and pay.status in ('pending','marked_paid') then update public.settlements set status='confirmed',confirmed_at=now() where id=target;
 else raise exception 'Thao tác không được phép hoặc khoản đã thay đổi';end if;
 update public.sessions set revision=revision+1 where id=s.id;
 if not exists(select 1 from public.settlements where session_id=s.id and status in ('pending','marked_paid')) then update public.sessions set status='settled',settled_at=now() where id=s.id;end if;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,s.id,auth.uid(),operation,jsonb_build_object('settlement_id',target));
end $$;
