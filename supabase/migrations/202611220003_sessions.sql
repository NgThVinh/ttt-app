alter table public.session_attendees add column commit_source text, add column removed_by uuid references auth.users, add column removal_reason text;
alter table public.expenses alter column paid_by drop not null;
alter table public.expenses add column amount_mode text not null default 'total' check(amount_mode in ('total','per_person')),
 add column split_mode text not null default 'equal' check(split_mode in ('equal','weighted','exact','percent')),
 add column unit_amount bigint, add column created_by uuid references auth.users, add column note text;
create table public.expense_split_inputs(expense_id uuid references public.expenses,member_id uuid references public.group_members,weight numeric not null check(weight>=0),created_at timestamptz not null default now(),primary key(expense_id,member_id));
alter table public.expense_split_inputs enable row level security;
create policy splits_read on public.expense_split_inputs for select to authenticated using(exists(select 1 from public.expenses e join public.sessions s on s.id=e.session_id where e.id=expense_id and public.is_member(s.group_id)));
grant select on public.expense_split_inputs,public.session_attendees,public.expenses,public.expense_allocations,public.settlements,public.attendance_events to authenticated;
revoke insert,update,delete on public.expense_split_inputs from anon,authenticated;
alter table public.settlements add column adjusts_settlement_id uuid references public.settlements,add column created_reason text;

create function public.next_payment_ref() returns text language plpgsql volatile security definer set search_path='' as $$
declare code text;
begin loop code:=translate(substr(replace(gen_random_uuid()::text,'-',''),1,6),'0123456789abcdef','23456789ABCDEFGH');if not exists(select 1 from public.settlements where ref_code=code) then return code;end if;end loop;end $$;

-- Internal transaction helper; public callers cannot invoke it directly.
create function public.recalculate_session(sid uuid, reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions; e public.expenses; m record; previous jsonb; denom numeric; units numeric; tail bigint; tail_member uuid; n bigint; from_id uuid; to_id uuid; amount_due bigint; old_id uuid;
begin
 select * into s from public.sessions where id=sid for update;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'amount',amount::text,'status',status)),'[]') into previous from public.settlements where session_id=sid;
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
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,sid,auth.uid(),'money_recalculated',jsonb_build_object('reason',reason,'before',previous,'after',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'amount',amount::text,'status',status)),'[]') from public.settlements where session_id=sid)));
 insert into public.audit_log(group_id,session_id,actor_id,action,payload) values(s.group_id,sid,auth.uid(),'allocation_snapshot',jsonb_build_object('allocations',(select coalesce(jsonb_agg(jsonb_build_object('expense_id',a.expense_id,'member_id',a.member_id,'amount',a.share_amount::text)),'[]') from public.expense_allocations a join public.expenses ex on ex.id=a.expense_id where ex.session_id=sid)));
end $$;

create function public.create_session(g uuid,title_text text,venue_text text,start_time timestamptz,deadline timestamptz,already_played boolean,people uuid[],court text,be_collector boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; sid uuid; eid uuid; total bigint;
begin
 if not public.is_member(g) then raise exception 'Không có quyền';end if;
 if already_played is null or be_collector is null or people is null then raise exception 'Thông tin buổi không hợp lệ';end if;
 if length(trim(title_text)) not between 1 and 160 or length(trim(venue_text)) not between 1 and 200 or deadline>start_time or start_time is null or deadline is null then raise exception 'Thông tin buổi không hợp lệ';end if;
 select id into actor from public.group_members where group_id=g and user_id=auth.uid() and status='active';
 if already_played and (not be_collector or start_time>now() or cardinality(people) not between 1 and 100) then raise exception 'Chọn người tham gia và người tính tiền cho buổi đã chơi';end if;
 if not already_played and (deadline<=now() or coalesce(cardinality(people),0)>0) then raise exception 'Buổi đặt trước cần hạn chốt trong tương lai; mỗi người tự chốt';end if;
 if be_collector and not exists(select 1 from public.profiles where id=auth.uid() and coalesce(bank_bin,'')<>'' and coalesce(bank_account_no,'')<>'' and coalesce(bank_account_name,'')<>'') then raise exception 'Người tính tiền cần lưu thông tin ngân hàng trước';end if;
 if already_played then
 if (select count(distinct x) from unnest(people) x)<>cardinality(people) or exists(select 1 from unnest(people) x where not exists(select 1 from public.group_members where id=x and group_id=g and status='active')) then raise exception 'Danh sách người tham gia không hợp lệ';end if;
 total:=court::bigint;if total<0 or total>1000000000000 then raise exception 'Tiền sân không hợp lệ';end if;
 end if;
 insert into public.sessions(group_id,title,venue,starts_at,commit_deadline,status,collector_member_id,created_by) values(g,trim(title_text),trim(venue_text),start_time,deadline,case when already_played then 'played' else 'planned' end,case when be_collector then actor else null end,auth.uid()) returning id into sid;
 if already_played then
 insert into public.session_attendees(session_id,member_id,rsvp,committed_at,commit_source) select sid,x,'going',now(),'added_by_collector' from unnest(people) x;
 insert into public.attendance_events(session_id,member_id,actor_id,action) select sid,x,auth.uid(),'added_by_collector' from unnest(people) x;
 insert into public.expenses(session_id,title,kind,amount,paid_by,created_by) values(sid,'Tiền sân','court',total,actor,auth.uid()) returning id into eid;
 insert into public.expense_split_inputs(expense_id,member_id,weight) select eid,x,1 from unnest(people) x;
 perform public.recalculate_session(sid,'Tạo buổi đã chơi');
 end if;
 insert into public.audit_log(group_id,session_id,actor_id,action) values(g,sid,auth.uid(),'session_created');return sid;
end $$;

create function public.set_rsvp(sid uuid,going boolean) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions; actor uuid;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 if s.status<>'planned' or now()>=s.commit_deadline then raise exception 'Đã qua hạn chốt. Cần gửi đề nghị cho người tính tiền';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 insert into public.session_attendees(session_id,member_id,rsvp,committed_at,commit_source) values(sid,actor,case when going then 'going' else 'not_going' end,now(),'self') on conflict(session_id,member_id) do update set rsvp=excluded.rsvp,committed_at=now(),commit_source='self',removed_at=null;
 insert into public.attendance_events(session_id,member_id,actor_id,action) values(sid,actor,auth.uid(),case when going then 'committed_going' else 'committed_not_going' end);
 update public.sessions set revision=revision+1 where id=sid;
end $$;

create function public.add_expense(sid uuid,expected_revision bigint,title_text text,raw_amount text,payer uuid,beneficiaries uuid[],mode text,split text,values_text text[],reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions; eid uuid; total bigint; i integer; ratio numeric; sum_ratio numeric:=0;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) or not exists(select 1 from public.group_members where id=s.collector_member_id and user_id=auth.uid() and status='active') then raise exception 'Chỉ người tính tiền được nhập khoản chi';end if;
 if s.revision<>expected_revision then raise exception 'Buổi đã thay đổi. Vui lòng tải lại để xem trước';end if;
 if s.status='cancelled' or (s.status='settled' and s.settled_at<now()-interval '30 days') then raise exception 'Buổi đã khóa';end if;
 if s.status='planned' then raise exception 'Hoàn tất buổi trước khi nhập chi phí';end if;
 if exists(select 1 from public.settlements where session_id=sid) and length(trim(reason)) not between 1 and 500 then raise exception 'Cần lý do thay đổi sau khi đã có khoản thu';end if;
 if length(trim(title_text)) not between 1 and 160 or cardinality(beneficiaries) not between 1 and 100 or cardinality(beneficiaries)<>(select count(distinct x) from unnest(beneficiaries) x) or mode not in ('total','per_person') or split not in ('equal','weighted','exact','percent') then raise exception 'Khoản chi không hợp lệ';end if;
 if (select count(*) from public.expenses where session_id=sid and status in ('active','proposed'))>=200 then raise exception 'Tối đa 200 khoản chi';end if;
 if not exists(select 1 from public.session_attendees where session_id=sid and member_id=payer and rsvp='going' and removed_at is null) or exists(select 1 from unnest(beneficiaries) x where not exists(select 1 from public.session_attendees where session_id=sid and member_id=x and rsvp='going' and removed_at is null)) then raise exception 'Người ứng và người chịu phải tham gia buổi';end if;
 total:=raw_amount::bigint;if abs(total::numeric)>1000000000000 then raise exception 'Số tiền vượt giới hạn';end if;if mode='per_person' then total:=total*cardinality(beneficiaries);end if;
 if split in ('exact','percent') and cardinality(values_text)<>cardinality(beneficiaries) then raise exception 'Nhập đủ các phần chia';end if;
 insert into public.expenses(session_id,title,amount,paid_by,created_by,amount_mode,split_mode,unit_amount) values(sid,trim(title_text),total,payer,auth.uid(),mode,split,case when mode='per_person' then raw_amount::bigint else null end) returning id into eid;
 for i in 1..cardinality(beneficiaries) loop
 ratio:=case when split='equal' then 1 when split='weighted' then (select weight from public.session_attendees where session_id=sid and member_id=beneficiaries[i]) else values_text[i]::numeric end;
 if ratio<0 or ratio<>round(ratio,6) or ratio>100000000000000 then raise exception 'Phần chia không hợp lệ';end if;
 sum_ratio:=sum_ratio+ratio;
 insert into public.expense_split_inputs values(eid,beneficiaries[i],ratio,now());
 end loop;
 if (split='percent' and sum_ratio<>100) or (split='exact' and sum_ratio<>abs(total::numeric)) then raise exception 'Tổng phần chia không khớp';end if;
 if sum_ratio=0 then update public.expense_split_inputs set weight=1 where expense_id=eid;end if;
 perform public.recalculate_session(sid,reason);
end $$;

create function public.finish_session(sid uuid,expected_revision bigint,court text) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions; actor uuid; eid uuid; total bigint;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 if actor is distinct from s.collector_member_id or s.status<>'planned' or now()<s.starts_at or now()<s.commit_deadline or s.revision<>expected_revision then raise exception 'Chưa thể hoàn tất buổi';end if;
 update public.session_attendees set rsvp='not_going',commit_source='auto_not_going' where session_id=sid and committed_at is null;
 if not exists(select 1 from public.session_attendees where session_id=sid and rsvp='going' and committed_at is not null and removed_at is null) then raise exception 'Chưa có người chốt tham gia';end if;
 total:=court::bigint;if total<0 or total>1000000000000 then raise exception 'Tiền sân không hợp lệ';end if;
 select id into eid from public.expenses where session_id=sid and kind='court' and status='active';
 if eid is null then insert into public.expenses(session_id,title,kind,amount,paid_by,created_by,split_mode) values(sid,'Tiền sân','court',total,actor,auth.uid(),'weighted') returning id into eid;
 else update public.expenses set amount=total where id=eid;end if;
 delete from public.expense_split_inputs where expense_id=eid;
 insert into public.expense_split_inputs(expense_id,member_id,weight) select eid,member_id,weight from public.session_attendees where session_id=sid and rsvp='going' and committed_at is not null and removed_at is null;
 update public.sessions set status='played' where id=sid;
 perform public.recalculate_session(sid,'Hoàn tất buổi chơi');
end $$;
create function public.claim_collector(sid uuid,expected_revision bigint,court text) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions;actor uuid;total bigint;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) or s.collector_member_id is not null or s.status='cancelled' or s.revision<>expected_revision then raise exception 'Không thể nhận vai trò. Buổi có thể đã thay đổi';end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and coalesce(bank_account_no,'')<>'' and coalesce(bank_bin,'')<>'' and coalesce(bank_account_name,'')<>'') then raise exception 'Cần lưu thông tin ngân hàng trước';end if;
 total:=court::bigint;if total<0 or total>1000000000000 then raise exception 'Tiền sân không hợp lệ';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 update public.sessions set collector_member_id=actor,revision=revision+1 where id=sid;
 insert into public.expenses(session_id,title,kind,amount,paid_by,created_by) values(sid,'Tiền sân','court',total,actor,auth.uid());
 insert into public.audit_log(group_id,session_id,actor_id,action) values(s.group_id,sid,auth.uid(),'collector_claimed');
end $$;
revoke all on function public.next_payment_ref(),public.recalculate_session(uuid,text) from public,anon,authenticated;
revoke all on function public.create_session(uuid,text,text,timestamptz,timestamptz,boolean,uuid[],text,boolean),public.set_rsvp(uuid,boolean),public.add_expense(uuid,bigint,text,text,uuid,uuid[],text,text,text[],text),public.finish_session(uuid,bigint,text),public.claim_collector(uuid,bigint,text) from public,anon;
grant execute on function public.create_session(uuid,text,text,timestamptz,timestamptz,boolean,uuid[],text,boolean),public.set_rsvp(uuid,boolean),public.add_expense(uuid,bigint,text,text,uuid,uuid[],text,text,text[],text),public.finish_session(uuid,bigint,text),public.claim_collector(uuid,bigint,text) to authenticated;
