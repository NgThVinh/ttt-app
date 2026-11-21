alter table public.attendance_events add column before jsonb,add column after jsonb,add column reason text,add column session_status_at_time text;
alter table public.expenses add column deleted_at timestamptz,add column deleted_by uuid references auth.users,add column deleted_reason text;
create function public.apply_financial_change(sid uuid,expected_revision bigint,action_name text,body jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions;actor uuid;target uuid;op text;new_weight numeric;previous jsonb;eid uuid;why text;
begin
 select * into s from public.sessions where id=sid for update;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền';end if;
 select id into actor from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active';
 if actor is distinct from s.collector_member_id then raise exception 'Chỉ người tính tiền được thay đổi phần tiền';end if;
 if s.revision<>expected_revision then raise exception 'Buổi đã thay đổi. Vui lòng xem trước lại';end if;
 if s.status not in ('played','settled') or (s.status='settled' and s.settled_at<now()-interval '30 days') then raise exception 'Buổi chưa thể sửa hoặc đã khóa';end if;
 why:=trim(body->>'reason');if why is null or length(why) not between 1 and 500 then raise exception 'Cần lý do thay đổi';end if;
 if action_name='attendee' then
 target:=(body->>'member_id')::uuid;op:=body->>'operation';
 if op is null or op not in ('add','remove','weight') then raise exception 'Thao tác không hợp lệ';end if;
 if not exists(select 1 from public.group_members where id=target and group_id=s.group_id and (op<>'add' or status='active')) then raise exception 'Thành viên không hợp lệ';end if;
 select to_jsonb(a) into previous from public.session_attendees a where session_id=sid and member_id=target;
 if op='add' then
 if exists(select 1 from public.session_attendees where session_id=sid and member_id=target and rsvp='going' and removed_at is null) then raise exception 'Người này đã tham gia';end if;
 insert into public.session_attendees(session_id,member_id,rsvp,committed_at,commit_source) values(sid,target,'going',now(),'added_by_collector') on conflict(session_id,member_id) do update set rsvp='going',committed_at=now(),commit_source='added_by_collector',removed_at=null,removed_by=null,removal_reason=null;
 else
 if not exists(select 1 from public.session_attendees where session_id=sid and member_id=target and rsvp='going' and removed_at is null) then raise exception 'Người này chưa tham gia';end if;
 if op='remove' then
 if (select count(*) from public.session_attendees where session_id=sid and rsvp='going' and removed_at is null)<=1 then raise exception 'Buổi cần ít nhất một người tham gia';end if;
 if exists(select 1 from public.expense_split_inputs i join public.expenses e on e.id=i.expense_id where e.session_id=sid and e.status='active' and e.split_mode in ('exact','percent') and i.member_id=target) then raise exception 'Cần điều chỉnh hoặc xóa khoản chia chính xác/phần trăm trước khi rút người';end if;
 if exists(select 1 from public.expenses e where e.session_id=sid and e.status='active' and exists(select 1 from public.expense_split_inputs i where i.expense_id=e.id and i.member_id=target) and (select count(*) from public.expense_split_inputs i where i.expense_id=e.id)<=1) then raise exception 'Xóa khoản chỉ người này chịu trước khi rút người';end if;
 update public.session_attendees set removed_at=now(),removed_by=auth.uid(),removal_reason=why where session_id=sid and member_id=target;
 delete from public.expense_split_inputs i using public.expenses e where e.id=i.expense_id and e.session_id=sid and e.status='active' and i.member_id=target;
 else
 new_weight:=(body->>'weight')::numeric;if new_weight is null or new_weight<=0 or new_weight>100 or new_weight<>round(new_weight,6) then raise exception 'Hệ số cần lớn hơn 0, tối đa 100';end if;
 update public.session_attendees set weight=new_weight where session_id=sid and member_id=target;
 update public.expense_split_inputs i set weight=new_weight from public.expenses e where e.id=i.expense_id and e.session_id=sid and e.status='active' and e.split_mode='weighted' and i.member_id=target;
 end if;end if;
 -- Court follows current attendance. Explicit extra beneficiaries stay explicit.
 for eid in select id from public.expenses where session_id=sid and status='active' and kind='court' loop
 update public.expenses set split_mode='weighted' where id=eid;
 delete from public.expense_split_inputs where expense_id=eid;
 insert into public.expense_split_inputs(expense_id,member_id,weight) select eid,member_id,weight from public.session_attendees where session_id=sid and rsvp='going' and removed_at is null;
 end loop;
 insert into public.attendance_events(session_id,member_id,actor_id,action,before,after,reason,session_status_at_time) values(sid,target,auth.uid(),case when op='add' then 'added' when op='remove' then 'removed' else 'weight_changed' end,previous,(select to_jsonb(a) from public.session_attendees a where session_id=sid and member_id=target),why,s.status);
 elsif action_name='delete_expense' then
 eid:=(body->>'expense_id')::uuid;
 update public.expenses set status='deleted',deleted_at=now(),deleted_by=auth.uid(),deleted_reason=why where id=eid and session_id=sid and status='active';
 if not found then raise exception 'Khoản chi đã thay đổi';end if;
 else raise exception 'Thao tác không hợp lệ';end if;
 update public.expenses e set amount=e.unit_amount*(select count(*) from public.expense_split_inputs i where i.expense_id=e.id) where e.session_id=sid and e.status='active' and e.amount_mode='per_person';
 perform public.recalculate_session(sid,why);
end $$;
create function public.preview_financial_change(sid uuid,expected_revision bigint,action_name text,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 begin
 perform public.apply_financial_change(sid,expected_revision,action_name,body);
 result:=public.session_details(sid);
 raise exception using errcode='PT001',message='rollback preview';
 exception when sqlstate 'PT001' then null;
 end;
 return result;
end $$;
revoke all on function public.apply_financial_change(uuid,bigint,text,jsonb),public.preview_financial_change(uuid,bigint,text,jsonb) from public,anon;
grant execute on function public.apply_financial_change(uuid,bigint,text,jsonb),public.preview_financial_change(uuid,bigint,text,jsonb) to authenticated;
