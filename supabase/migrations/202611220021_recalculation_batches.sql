create table public.session_recalculations (
 id uuid primary key,
 session_id uuid not null references public.sessions,
 group_id uuid not null references public.groups,
 previous_id uuid references public.session_recalculations,
 revision_before bigint not null,
 revision_after bigint not null check(revision_after>revision_before),
 actor_id uuid references auth.users,
 reason text not null,
 snapshot_before jsonb not null,
 snapshot_after jsonb not null,
 created_at timestamptz not null default now()
);
create index session_recalculations_session on public.session_recalculations(session_id,created_at);
alter table public.session_recalculations enable row level security;
revoke all on public.session_recalculations from public,anon,authenticated,service_role;
grant select on public.session_recalculations to authenticated;
create policy recalculation_read on public.session_recalculations for select to authenticated using(public.is_member(group_id));
create trigger immutable_recalculation before update or delete on public.session_recalculations for each row execute function public.immutable_log();
create trigger recalculation_no_truncate before truncate on public.session_recalculations for each statement execute function public.immutable_log();
alter table public.sessions add column last_recalculation_id uuid references public.session_recalculations;
alter table public.settlements add column recalculation_id uuid references public.session_recalculations,
 add column cancelled_by_recalculation_id uuid references public.session_recalculations;

-- The allocation/reconciliation arithmetic remains unchanged; append trace records atomically.
create or replace function public.recalculate_session(sid uuid, reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions; e public.expenses; m record; previous jsonb; denom numeric; units numeric; tail bigint; tail_member uuid; n bigint; from_id uuid; to_id uuid; amount_due bigint; old_id uuid; batch_id uuid:=gen_random_uuid(); current_snapshot jsonb;
begin
 select * into s from public.sessions where id=sid for update;
 if not found then raise exception 'Bu?i kh?ng t?n t?i';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'amount',amount::text,'status',status,'from_member',from_member,'to_member',to_member,'kind',kind,'adjusts_settlement_id',adjusts_settlement_id) order by id),'[]') into previous from public.settlements where session_id=sid;
 previous:=jsonb_build_object('settlements',previous,'allocations',(select coalesce(jsonb_agg(jsonb_build_object('expense_id',a.expense_id,'member_id',a.member_id,'amount',a.share_amount::text)),'[]') from public.expense_allocations a join public.expenses ex on ex.id=a.expense_id where ex.session_id=sid));
 delete from public.expense_allocations a using public.expenses ex where a.expense_id=ex.id and ex.session_id=sid;
 for e in select * from public.expenses where session_id=sid and status='active' loop
 select sum(weight) into denom from public.expense_split_inputs where expense_id=e.id;
 if denom is null or denom<=0 then raise exception 'Khoản chi cần người chịu hợp lệ';end if;
 units:=floor(abs(e.amount::numeric)/1000);tail:=(abs(e.amount::numeric)%1000)::bigint;
 select member_id into tail_member from public.expense_split_inputs where expense_id=e.id order by (member_id=e.paid_by) desc,weight desc,member_id limit 1;
 insert into public.expense_allocations(expense_id,member_id,share_amount)
 with parts as(select member_id,floor(units*weight/denom) base,mod(units*weight,denom) rem from public.expense_split_inputs where expense_id=e.id),
 ranked as(select *,row_number() over(order by rem desc,member_id) rank,sum(base) over() total_base from parts)
 select e.id,member_id,(case when e.amount<0 then -1 else 1 end)*((base+case when rank<=units-total_base then 1 else 0 end)*1000+case when member_id=tail_member then tail else 0 end)::bigint from ranked;
 end loop;
 if s.collector_member_id is not null and s.status in ('played','settled') then
 for m in
 with flows as(
 select paid_by member_id,amount::numeric value from public.expenses where session_id=sid and status='active'
 union all select a.member_id,-a.share_amount::numeric from public.expense_allocations a join public.expenses ex on ex.id=a.expense_id where ex.session_id=sid
 union all select from_member,amount::numeric from public.settlements where session_id=sid and status='confirmed'
 union all select to_member,-amount::numeric from public.settlements where session_id=sid and status='confirmed'
 union all select from_member,0::numeric from public.settlements where session_id=sid
 union all select to_member,0::numeric from public.settlements where session_id=sid
 ) select member_id,sum(value)::bigint balance from flows where member_id is not null and member_id<>s.collector_member_id group by member_id
 loop
 n:=m.balance;from_id:=case when n<0 then m.member_id else s.collector_member_id end;to_id:=case when n<0 then s.collector_member_id else m.member_id end;amount_due:=abs(n);
 select id into old_id from public.settlements where session_id=sid and status in ('pending','marked_paid') and from_member=from_id and to_member=to_id and amount=amount_due limit 1;
 update public.settlements set status='cancelled' where session_id=sid and status in ('pending','marked_paid') and (from_member=m.member_id or to_member=m.member_id) and id is distinct from old_id;
 if amount_due>0 and old_id is null then
 loop begin
 insert into public.settlements(session_id,from_member,to_member,amount,ref_code,kind,adjusts_settlement_id,created_reason)
 values(sid,from_id,to_id,amount_due,public.next_payment_ref(),case when exists(select 1 from public.settlements where session_id=sid and status='confirmed') then 'adjustment' else 'original' end,(select id from public.settlements where session_id=sid and status='confirmed' and (from_member=m.member_id or to_member=m.member_id) order by confirmed_at desc limit 1),reason);exit;
 exception when unique_violation then null;end;end loop;
 end if;
 end loop;
 update public.sessions set status=case when exists(select 1 from public.settlements where session_id=sid and status in ('pending','marked_paid')) then 'played' else 'settled' end,
 settled_at=case when exists(select 1 from public.settlements where session_id=sid and status in ('pending','marked_paid')) then null else coalesce(settled_at,now()) end where id=sid;
 end if;
 update public.sessions set revision=revision+1 where id=sid;

 select jsonb_build_object('settlements',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'amount',amount::text,'status',status,'from_member',from_member,'to_member',to_member,'kind',kind,'adjusts_settlement_id',adjusts_settlement_id) order by id),'[]') from public.settlements where session_id=sid),'allocations',(select coalesce(jsonb_agg(jsonb_build_object('expense_id',a.expense_id,'member_id',a.member_id,'amount',a.share_amount::text) order by a.expense_id,a.member_id),'[]') from public.expense_allocations a join public.expenses expense_row on expense_row.id=a.expense_id where expense_row.session_id=sid)) into current_snapshot;
 insert into public.session_recalculations(id,session_id,group_id,previous_id,revision_before,revision_after,actor_id,reason,snapshot_before,snapshot_after)
 values(batch_id,sid,s.group_id,s.last_recalculation_id,s.revision,(select revision from public.sessions where id=sid),auth.uid(),coalesce(reason,''),previous,current_snapshot);
 update public.settlements p set recalculation_id=batch_id where p.session_id=sid and p.status<>'confirmed' and not exists(select 1 from jsonb_array_elements(previous->'settlements') old where (old->>'id')::uuid=p.id);
 update public.settlements p set cancelled_by_recalculation_id=batch_id where p.session_id=sid and p.status='cancelled' and p.cancelled_by_recalculation_id is null and exists(select 1 from jsonb_array_elements(previous->'settlements') old where (old->>'id')::uuid=p.id and old->>'status' in ('pending','marked_paid'));
 update public.sessions set last_recalculation_id=batch_id where id=sid;
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,sid,auth.uid(),'money_recalculated',jsonb_build_object('reason',reason,'batch_id',batch_id,'previous_batch_id',s.last_recalculation_id,'before',previous,'after',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'amount',amount::text,'status',status,'from_member',from_member,'to_member',to_member,'kind',kind,'adjusts_settlement_id',adjusts_settlement_id) order by id),'[]') from public.settlements where session_id=sid)));
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,sid,auth.uid(),'allocation_snapshot',jsonb_build_object('batch_id',batch_id,'allocations',(select coalesce(jsonb_agg(jsonb_build_object('expense_id',a.expense_id,'member_id',a.member_id,'amount',a.share_amount::text)),'[]') from public.expense_allocations a join public.expenses ex on ex.id=a.expense_id where ex.session_id=sid)));
end $$;

revoke all on function public.recalculate_session(uuid,text) from public,anon,authenticated;
