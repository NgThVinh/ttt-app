create function public.session_details(sid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.sessions;result jsonb;
begin
 select * into s from public.sessions where id=sid;
 if not found or not public.is_member(s.group_id) then raise exception 'Không có quyền xem buổi';end if;
 result:=jsonb_build_object('id',s.id,'group_id',s.group_id,'title',s.title,'venue',s.venue,'starts_at',s.starts_at,'commit_deadline',s.commit_deadline,'status',s.status,'revision',s.revision::text,'deadline_passed',now()>=s.commit_deadline,'collector_member_id',s.collector_member_id,
 'my_member_id',(select id from public.group_members where group_id=s.group_id and user_id=auth.uid() and status='active'),
 'attendees',(select coalesce(jsonb_agg(jsonb_build_object('member_id',a.member_id,'name',m.display_name,'rsvp',a.rsvp,'weight',a.weight::text,'committed_at',a.committed_at,'removed_at',a.removed_at)),'[]') from public.session_attendees a join public.group_members m on m.id=a.member_id where a.session_id=sid),
 'expenses',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'amount',e.amount::text,'paid_by',e.paid_by,'split_mode',e.split_mode,'allocations',(select coalesce(jsonb_agg(jsonb_build_object('member_id',a.member_id,'amount',a.share_amount::text)),'[]') from public.expense_allocations a where a.expense_id=e.id)) order by e.created_at),'[]') from public.expenses e where e.session_id=sid and e.status='active'),
 'settlements',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'from_member',p.from_member,'to_member',p.to_member,'from_name',f.display_name,'to_name',t.display_name,'amount',p.amount::text,'ref_code',p.ref_code,'status',p.status,'kind',p.kind,'bank_bin',bank.bank_bin,'bank_account_no',bank.bank_account_no,'bank_account_name',bank.bank_account_name) order by p.created_at),'[]') from public.settlements p join public.group_members f on f.id=p.from_member join public.group_members t on t.id=p.to_member left join public.profiles bank on bank.id=t.user_id and t.status='active' where p.session_id=sid and p.status<>'cancelled'),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('action',a.action,'created_at',a.created_at,'reason',a.payload->>'reason') order by a.created_at desc),'[]') from public.audit_log a where a.session_id=sid));return result;
end $$;
create function public.my_settlements() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'session_id',s.id,'session_title',s.title,'group_id',s.group_id,'from_member',p.from_member,'to_member',p.to_member,'from_name',f.display_name,'to_name',t.display_name,'amount',p.amount::text,'status',p.status,'ref_code',p.ref_code,'mine_is_sender',f.user_id=auth.uid()) order by p.created_at desc),'[]') from public.settlements p join public.sessions s on s.id=p.session_id join public.group_members f on f.id=p.from_member join public.group_members t on t.id=p.to_member where public.is_member(s.group_id) and (f.user_id=auth.uid() or t.user_id=auth.uid()) and p.status<>'cancelled'
$$;
revoke all on function public.session_details(uuid),public.my_settlements() from public,anon;
grant execute on function public.session_details(uuid),public.my_settlements() to authenticated;

