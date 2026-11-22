create table app_private.push_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users,endpoint text not null unique,p256dh text not null,auth_key text not null,active boolean not null default true,created_at timestamptz not null default now());
create table app_private.push_deliveries(id uuid primary key default gen_random_uuid(),notification_id uuid not null references public.notifications,subscription_id uuid not null references app_private.push_subscriptions,attempts integer not null default 0,available_at timestamptz not null default now(),lease_until timestamptz,lease_token uuid,finished_at timestamptz,created_at timestamptz not null default now(),unique(notification_id,subscription_id));
alter table app_private.push_subscriptions enable row level security;
alter table app_private.push_deliveries enable row level security;
revoke all on app_private.push_subscriptions,app_private.push_deliveries from public,anon,authenticated,service_role;

create function public.save_push_subscription(endpoint_text text,p256dh_text text,auth_text text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or length(endpoint_text)>2048 or endpoint_text !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/' or p256dh_text !~ '^[A-Za-z0-9_-]{87}$' or auth_text !~ '^[A-Za-z0-9_-]{22}$' then raise exception 'Đăng ký push không hợp lệ';end if;
 perform pg_advisory_xact_lock(hashtextextended('push-user:'||auth.uid(),0));
 if exists(select 1 from app_private.push_subscriptions where endpoint=endpoint_text and user_id<>auth.uid()) then raise exception 'Hãy hủy đăng ký trên thiết bị trước khi đổi tài khoản';end if;
 if(select count(*) from app_private.push_subscriptions where user_id=auth.uid() and active and endpoint<>endpoint_text)>=10 then raise exception 'Tối đa 10 thiết bị';end if;
 insert into app_private.push_subscriptions(user_id,endpoint,p256dh,auth_key) values(auth.uid(),endpoint_text,p256dh_text,auth_text) on conflict(endpoint) do update set p256dh=excluded.p256dh,auth_key=excluded.auth_key,active=true;
end $$;
create function public.remove_push_subscription(endpoint_text text) returns void language sql security definer set search_path='' as $$update app_private.push_subscriptions set active=false where user_id=auth.uid() and endpoint=endpoint_text$$;
create function app_private.queue_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into app_private.push_deliveries(notification_id,subscription_id) select new.id,id from app_private.push_subscriptions where user_id=new.user_id and active on conflict do nothing;
 return new;
end $$;
create trigger notification_push after insert on public.notifications for each row execute function app_private.queue_push();
revoke all on function app_private.queue_push() from public,anon,authenticated,service_role;

create function public.claim_push_deliveries() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update app_private.push_deliveries d set finished_at=now() where d.finished_at is null and (d.attempts>=5 or d.created_at<now()-interval '2 days' or not exists(select 1 from app_private.push_subscriptions s join public.notifications n on n.id=d.notification_id join public.group_members m on m.group_id=n.group_id and m.user_id=s.user_id and m.status='active' where s.id=d.subscription_id and s.active));
 with candidates as (select id from app_private.push_deliveries where finished_at is null and available_at<=now() and (lease_until is null or lease_until<now()) order by created_at limit 30 for update skip locked), claimed as (update app_private.push_deliveries d set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1 from candidates c where d.id=c.id returning d.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'token',d.lease_token,'endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth_key),'tag',n.id,'href',n.href)),'[]') into result from claimed d join app_private.push_subscriptions s on s.id=d.subscription_id join public.notifications n on n.id=d.notification_id;
 return result;
end $$;
create function public.finish_push_delivery(target uuid,token uuid,outcome text) returns void language plpgsql security definer set search_path='' as $$
declare subscription uuid;
begin
 if outcome not in ('sent','expired','retry') then raise exception 'Kết quả không hợp lệ';end if;
 update app_private.push_deliveries set finished_at=case when outcome<>'retry' or attempts>=5 then now() else null end,available_at=now()+interval '5 minutes',lease_until=null,lease_token=null where id=target and lease_token=token and lease_until>now() and finished_at is null returning subscription_id into subscription;
 if outcome='expired' and subscription is not null then update app_private.push_subscriptions set active=false where id=subscription;end if;
end $$;
revoke all on function public.claim_push_deliveries(),public.finish_push_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_push_deliveries(),public.finish_push_delivery(uuid,uuid,text) to service_role;
revoke all on function public.save_push_subscription(text,text,text),public.remove_push_subscription(text) from public,anon,service_role;
grant execute on function public.save_push_subscription(text,text,text),public.remove_push_subscription(text) to authenticated;

create function public.remind_payment(target uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.settlements;s public.sessions;receiver public.group_members;sender public.group_members;actor uuid;event text;
begin
 select session.* into s from public.sessions session join public.settlements t on t.session_id=session.id where t.id=target for update of session;
 select * into p from public.settlements where id=target;
 if not found or not public.is_member(s.group_id) or p.status<>'pending' then raise exception 'Khoản này không còn chờ chuyển';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 if actor<>p.to_member or p.to_member<>s.collector_member_id then raise exception 'Chỉ người đang thu khoản này được nhắc';end if;
 if exists(select 1 from public.audit_log where session_id=s.id and action='payment_reminder' and payload->>'settlement_id'=target::text and created_at>now()-interval '1 day') then raise exception 'Mỗi khoản chỉ nhắc một lần trong 24 giờ';end if;
 select * into sender from public.group_members where id=p.from_member and status='active';
 if sender.user_id is null then raise exception 'Người chuyển chưa có tài khoản';end if;
 event:='manual-debt:'||target||':'||gen_random_uuid();
 insert into public.notifications(group_id,user_id,event_key,title,href) values(s.group_id,sender.user_id,event,'Bạn có khoản cần thanh toán: '||s.title,'/sessions/'||s.id);
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,s.id,auth.uid(),'payment_reminder',jsonb_build_object('settlement_id',target));
end $$;
revoke all on function public.remind_payment(uuid) from public,anon,service_role;
grant execute on function public.remind_payment(uuid) to authenticated;
