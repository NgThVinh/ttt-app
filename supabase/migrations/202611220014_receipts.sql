create table public.payment_evidence(id uuid primary key default gen_random_uuid(),settlement_id uuid not null references public.settlements,group_id uuid not null references public.groups,uploaded_by uuid not null references auth.users,kind text not null check(kind in ('screenshot','bank_txn_ref','note')),storage_path text unique,bank_txn_ref text check(length(bank_txn_ref)<=120),note text check(length(note)<=1000),transferred_at timestamptz,status text not null default 'ready' check(status in ('reserved','ready','expired')),created_at timestamptz not null default now());
create table public.expense_receipts(id uuid primary key default gen_random_uuid(),expense_id uuid not null references public.expenses,group_id uuid not null references public.groups,uploaded_by uuid not null references auth.users,storage_path text not null unique,status text not null default 'reserved' check(status in ('reserved','ready','expired')),created_at timestamptz not null default now());
create table public.storage_cleanup_jobs(id uuid primary key default gen_random_uuid(),bucket text not null check(bucket in ('3t-payment-evidence','3t-expense-receipts')),path text not null,status text not null default 'pending' check(status in ('pending','processing','finished')),attempts integer not null default 0,available_at timestamptz not null default now(),lease_until timestamptz,lease_token uuid,finished_at timestamptz,created_at timestamptz not null default now(),unique(bucket,path));
alter table public.payment_evidence enable row level security;
alter table public.expense_receipts enable row level security;
alter table public.storage_cleanup_jobs enable row level security;
revoke all on public.payment_evidence,public.expense_receipts,public.storage_cleanup_jobs from public,anon,authenticated;
grant select on public.payment_evidence,public.expense_receipts to authenticated;
create function public.can_read_payment_evidence(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.settlements p join public.sessions s on s.id=p.session_id join public.group_members m on m.group_id=s.group_id and m.user_id=auth.uid() and m.status='active' where p.id=target and (m.id in (p.from_member,p.to_member) or m.role='admin'))
$$;
create policy evidence_read on public.payment_evidence for select to authenticated using(public.can_read_payment_evidence(settlement_id));
create policy expense_receipt_read on public.expense_receipts for select to authenticated using(public.is_member(group_id));
create function public.can_read_receipt_file(bucket text,path text) returns boolean language sql stable security definer set search_path='' as $$
 select case when bucket='3t-payment-evidence' then exists(select 1 from public.payment_evidence e join public.settlements p on p.id=e.settlement_id where e.storage_path=path and public.can_read_payment_evidence(p.id) and (p.confirmed_at is null or p.confirmed_at>now()-interval '30 days') and (e.status='ready' or (e.status='reserved' and e.uploaded_by=auth.uid() and e.created_at>now()-interval '15 minutes')))
 when bucket='3t-expense-receipts' then exists(select 1 from public.expense_receipts r where r.storage_path=path and public.is_member(r.group_id) and (r.status='ready' or (r.status='reserved' and r.uploaded_by=auth.uid() and r.created_at>now()-interval '15 minutes'))) else false end
$$;
create function public.can_upload_receipt_file(bucket text,path text) returns boolean language sql stable security definer set search_path='' as $$
 select case when bucket='3t-payment-evidence' then exists(select 1 from public.payment_evidence e join public.settlements p on p.id=e.settlement_id join public.group_members m on m.id=p.from_member where e.storage_path=path and e.uploaded_by=auth.uid() and m.user_id=auth.uid() and m.status='active' and public.is_member(e.group_id) and e.status='reserved' and e.created_at>now()-interval '15 minutes' and p.status in ('pending','marked_paid','confirmed') and (p.confirmed_at is null or p.confirmed_at>now()-interval '30 days'))
 when bucket='3t-expense-receipts' then exists(select 1 from public.expense_receipts r join public.expenses e on e.id=r.expense_id join public.sessions s on s.id=e.session_id where r.storage_path=path and r.uploaded_by=auth.uid() and public.is_member(r.group_id) and r.status='reserved' and r.created_at>now()-interval '15 minutes' and e.status in ('active','proposed') and (e.created_by=auth.uid() or exists(select 1 from public.group_members where id=s.collector_member_id and user_id=auth.uid())) and not(s.status='settled' and s.settled_at<now()-interval '30 days')) else false end
$$;
create function public.add_payment_evidence(target uuid,kind_text text,reference_text text default null,note_text text default null,transfer_time timestamptz default null) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.settlements;g uuid;actor uuid;eid uuid:=gen_random_uuid();path text;
begin
 select group_id into g from public.sessions s join public.settlements t on t.session_id=s.id where t.id=target for update of s;
 select * into p from public.settlements where id=target for update;
 select id into actor from public.group_members where group_id=g and user_id=auth.uid() and status='active';
 if actor is null or actor<>p.from_member or p.status not in ('pending','marked_paid','confirmed') or (p.confirmed_at is not null and p.confirmed_at<=now()-interval '30 days') then raise exception 'Chỉ người chuyển được bổ sung bằng chứng trong hạn';end if;
 if kind_text is null or kind_text not in ('screenshot','bank_txn_ref','note') or length(coalesce(reference_text,''))>120 or length(coalesce(note_text,''))>1000 or transfer_time>now()+interval '5 minutes' then raise exception 'Bằng chứng không hợp lệ';end if;
 if kind_text='bank_txn_ref' and length(trim(coalesce(reference_text,'')))=0 or kind_text='note' and length(trim(coalesce(note_text,'')))=0 then raise exception 'Cần nội dung bằng chứng';end if;
 if (select count(*) from public.payment_evidence where settlement_id=target)>=20 then raise exception 'Tối đa 20 bằng chứng cho mỗi khoản';end if;
 path:=case when kind_text='screenshot' then g||'/'||eid||'.jpg' else null end;
 insert into public.payment_evidence(id,settlement_id,group_id,uploaded_by,kind,storage_path,bank_txn_ref,note,transferred_at,status) values(eid,target,g,auth.uid(),kind_text,path,reference_text,note_text,transfer_time,case when kind_text='screenshot' then 'reserved' else 'ready' end);
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(g,p.session_id,auth.uid(),'payment_evidence_added',jsonb_build_object('evidence_id',eid,'kind',kind_text));return eid;
end $$;
create function public.reserve_expense_receipt(target uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.expenses;s public.sessions;rid uuid:=gen_random_uuid();
begin
 select session.* into s from public.sessions session join public.expenses ex on ex.session_id=session.id where ex.id=target for update of session;
 select * into e from public.expenses where id=target;
 if not public.is_member(s.group_id) or e.status not in ('active','proposed') or (e.created_by is distinct from auth.uid() and not exists(select 1 from public.group_members where id=s.collector_member_id and user_id=auth.uid())) or (s.status='settled' and s.settled_at<now()-interval '30 days') then raise exception 'Không có quyền thêm hóa đơn';end if;
 if (select count(*) from public.expense_receipts where expense_id=target)>=20 then raise exception 'Tối đa 20 ảnh hóa đơn';end if;
 insert into public.expense_receipts(id,expense_id,group_id,uploaded_by,storage_path) values(rid,target,s.group_id,auth.uid(),s.group_id||'/'||rid||'.jpg');return rid;
end $$;
create function public.finalize_receipt(bucket text,target uuid) returns void language plpgsql security definer set search_path='' as $$
declare path text;size bigint;mime text;
begin
 if bucket='3t-payment-evidence' then select storage_path into path from public.payment_evidence where id=target and uploaded_by=auth.uid() and status='reserved';
 elsif bucket='3t-expense-receipts' then select storage_path into path from public.expense_receipts where id=target and uploaded_by=auth.uid() and status='reserved';end if;
 if path is null or not public.can_upload_receipt_file(bucket,path) then raise exception 'Phiên tải ảnh không hợp lệ';end if;
 execute 'select (metadata->>''size'')::bigint,metadata->>''mimetype'' from storage.objects where bucket_id=$1 and name=$2' into size,mime using bucket,path;
 if size is null or size<=0 or size>2097152 or mime not in ('image/jpeg','image/png','image/webp') then raise exception 'Ảnh chưa tải xong hoặc không hợp lệ';end if;
 if bucket='3t-payment-evidence' then update public.payment_evidence set status='ready' where id=target;else update public.expense_receipts set status='ready' where id=target;end if;
end $$;
revoke all on function public.can_read_payment_evidence(uuid),public.can_read_receipt_file(text,text),public.can_upload_receipt_file(text,text),public.add_payment_evidence(uuid,text,text,text,timestamptz),public.reserve_expense_receipt(uuid),public.finalize_receipt(text,uuid) from public,anon;
grant execute on function public.can_read_payment_evidence(uuid),public.can_read_receipt_file(text,text),public.can_upload_receipt_file(text,text),public.add_payment_evidence(uuid,text,text,text,timestamptz),public.reserve_expense_receipt(uuid),public.finalize_receipt(text,uuid) to authenticated;
