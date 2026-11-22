create table public.guest_bank_accounts (
 member_id uuid primary key references public.group_members,
 group_id uuid not null references public.groups,
 bank_bin text not null check(bank_bin ~ '^[0-9]{6}$'),
 bank_account_no text not null check(bank_account_no ~ '^[A-Za-z0-9]{4,30}$'),
 bank_account_name text not null check(length(trim(bank_account_name)) between 1 and 100),
 revision bigint not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.guest_bank_accounts enable row level security;
revoke all on public.guest_bank_accounts from public,anon,authenticated,service_role;
grant select on public.guest_bank_accounts to authenticated;
create policy guest_bank_read on public.guest_bank_accounts for select to authenticated using(public.is_member(group_id) and exists(select 1 from public.group_members m where m.id=guest_bank_accounts.member_id and m.group_id=guest_bank_accounts.group_id and m.user_id is null and m.status='active'));
create function public.set_guest_bank(target uuid,bank_bin_text text,account_text text,name_text text,reason text) returns void language plpgsql security definer set search_path='' as $$
declare m public.group_members; next_revision bigint;
begin
 select * into m from public.group_members where id=target;
 if not found or not public.is_group_admin(m.group_id) then raise exception 'Chỉ admin nhóm được nhập ngân hàng cho thành viên khách';end if;
 perform 1 from public.groups where id=m.group_id for update;
 select * into m from public.group_members where id=target for update;
 if m.user_id is not null or m.status<>'active' then raise exception 'Thành viên đã có tài khoản cần tự quản lý ngân hàng';end if;
 if bank_bin_text is null or bank_bin_text !~ '^[0-9]{6}$' or account_text is null or account_text !~ '^[A-Za-z0-9]{4,30}$' or coalesce(length(trim(name_text)),0) not between 1 and 100 or coalesce(length(trim(reason)),0) not between 1 and 500 then raise exception 'Cần đủ thông tin ngân hàng và lý do';end if;
 insert into public.guest_bank_accounts(member_id,group_id,bank_bin,bank_account_no,bank_account_name) values(target,m.group_id,bank_bin_text,account_text,trim(name_text)) on conflict(member_id) do update set bank_bin=excluded.bank_bin,bank_account_no=excluded.bank_account_no,bank_account_name=excluded.bank_account_name,revision=public.guest_bank_accounts.revision+1,updated_at=now() returning revision into next_revision;
 insert into public.audit_log(group_id,actor_id,action,payload) values(m.group_id,auth.uid(),'guest_bank_updated',jsonb_build_object('member_id',target,'reason',trim(reason),'revision',next_revision::text));
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) select m.group_id,s.id,auth.uid(),'guest_bank_updated',jsonb_build_object('member_id',target,'reason',trim(reason)) from public.sessions s where s.group_id=m.group_id and (s.collector_member_id=target or exists(select 1 from public.settlements p where p.session_id=s.id and p.to_member=target));
 perform public.notify_group(m.group_id,'guest-bank:'||target||':'||next_revision,'Admin đã cập nhật ngân hàng thành viên chưa có tài khoản; hãy kiểm tra thông tin trước khi chuyển.','/groups/'||m.group_id);
end $$;
revoke all on function public.set_guest_bank(uuid,text,text,text,text) from public,anon,service_role;
grant execute on function public.set_guest_bank(uuid,text,text,text,text) to authenticated;

create or replace function public.session_details_core(sid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.sessions;result jsonb;
begin
 select * into s from public.sessions where id=sid;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền xem buổi';end if;
 result:=jsonb_build_object('id',s.id,'group_id',s.group_id,'title',s.title,'venue',s.venue,'starts_at',s.starts_at,'commit_deadline',s.commit_deadline,'status',s.status,'revision',s.revision::text,'deadline_passed',now()>=s.commit_deadline,'collector_member_id',s.collector_member_id,
 'my_member_id',(select id from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active'),
 'attendees',(select coalesce(jsonb_agg(jsonb_build_object('member_id',a.member_id,'name',m.display_name,'rsvp',a.rsvp,'weight',a.weight::text,'committed_at',a.committed_at,'removed_at',a.removed_at)),'[]') from public.session_attendees a join public.group_members m on m.id=a.member_id where a.session_id=sid),
 'expenses',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'amount',e.amount::text,'paid_by',e.paid_by,'split_mode',e.split_mode,'allocations',(select coalesce(jsonb_agg(jsonb_build_object('member_id',a.member_id,'amount',a.share_amount::text)),'[]') from public.expense_allocations a where a.expense_id=e.id)) order by e.created_at),'[]') from public.expenses e where e.session_id=sid and e.status='active'),
 'settlements',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'from_member',p.from_member,'to_member',p.to_member,'from_name',f.display_name,'to_name',t.display_name,'amount',p.amount::text,'ref_code',p.ref_code,'status',p.status,'kind',p.kind,'bank_bin',case when t.user_id is null then guest.bank_bin else bank.bank_bin end,'bank_account_no',case when t.user_id is null then guest.bank_account_no else bank.bank_account_no end,'bank_account_name',case when t.user_id is null then guest.bank_account_name else bank.bank_account_name end) order by p.created_at),'[]') from public.settlements p join public.group_members f on f.id=p.from_member join public.group_members t on t.id=p.to_member left join public.profiles bank on bank.id=t.user_id and t.status='active' left join public.guest_bank_accounts guest on guest.member_id=t.id and t.user_id is null and t.status='active' where p.session_id=sid and p.status<>'cancelled'),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('action',a.action,'created_at',a.created_at,'reason',a.payload->>'reason') order by a.created_at desc),'[]') from public.audit_log a where a.session_id=sid));return result;
end $$;
revoke all on function public.session_details_core(uuid) from public,anon,authenticated,service_role;
