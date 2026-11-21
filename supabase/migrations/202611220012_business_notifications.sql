create function public.notify_approval_change() returns trigger language plpgsql security definer set search_path='' as $$
declare destination text;message text;
begin
 destination:=case when new.session_id is null then '/groups/'||new.group_id else '/approvals' end;
 if new.status='pending' and (tg_op='INSERT' or new.required_authority is distinct from old.required_authority) then
 insert into public.notifications(group_id,user_id,event_key,title,href)
 select new.group_id,m.user_id,'request:'||new.id||':'||new.required_authority,'Có yêu cầu mới đang chờ bạn duyệt',destination from public.group_members m where m.group_id=new.group_id and m.status='active' and m.user_id is not null and (m.id::text=new.required_authority or (new.required_authority='group_admin' and m.role='admin')) on conflict(user_id,event_key) do nothing;
 elsif tg_op='UPDATE' and new.status is distinct from old.status and new.status in ('approved','rejected','expired') then
 message:=case new.status when 'approved' then 'Yêu cầu của bạn đã được duyệt' when 'rejected' then 'Yêu cầu của bạn đã bị từ chối' else 'Yêu cầu của bạn đã hết hạn; không có thay đổi nào tự động được duyệt' end;
 insert into public.notifications(group_id,user_id,event_key,title,href) values(new.group_id,new.requested_by,'request-result:'||new.id,message,destination) on conflict(user_id,event_key) do nothing;
 end if;return new;
end $$;
create trigger approval_notification after insert or update on public.approval_requests for each row execute function public.notify_approval_change();
create function public.notify_settlement_change() returns trigger language plpgsql security definer set search_path='' as $$
declare g uuid;recipient uuid;event text;message text;
begin
 select group_id into g from public.sessions where id=new.session_id;
 if tg_op='INSERT' then recipient:=new.from_member;event:='issued';message:='Bạn có khoản cần thanh toán mới';
 elsif new.status is distinct from old.status and new.status='marked_paid' then recipient:=new.to_member;event:='marked';message:='Có người báo đã chuyển; hãy kiểm tra sao kê trước khi xác nhận';
 elsif new.status is distinct from old.status and new.status='confirmed' then recipient:=new.from_member;event:='confirmed';message:='Người nhận đã xác nhận khoản của bạn';
 elsif new.status is distinct from old.status and new.status='cancelled' then
 insert into public.notifications(group_id,user_id,event_key,title,href) select g,user_id,'payment-cancelled:'||new.id,'Khoản cũ được thay thế. Kiểm tra công nợ mới trước khi chuyển.','/sessions/'||new.session_id from public.group_members where id in (new.from_member,new.to_member) and status='active' and user_id is not null on conflict(user_id,event_key) do nothing;return new;
 else return new;end if;
 insert into public.notifications(group_id,user_id,event_key,title,href) select g,user_id,'payment:'||new.id||':'||event,message,'/sessions/'||new.session_id from public.group_members where id=recipient and status='active' and user_id is not null on conflict(user_id,event_key) do nothing;return new;
end $$;
create trigger settlement_notification after insert or update on public.settlements for each row execute function public.notify_settlement_change();
revoke all on function public.notify_approval_change(),public.notify_settlement_change() from public,anon,authenticated;
