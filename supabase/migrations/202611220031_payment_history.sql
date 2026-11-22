create function public.replaced_payments(sid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;result jsonb;
begin
 select group_id into g from public.sessions where id=sid;
 if g is null or not public.is_member(g) then raise exception 'Không có quyền';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'amount',p.amount::text,'from_name',f.display_name,'to_name',t.display_name,'ref_code',p.ref_code,'created_at',p.created_at,'reason',p.created_reason,'can_read_evidence',public.can_read_payment_evidence(p.id)) order by p.created_at desc,p.id),'[]') into result
 from public.settlements p join public.group_members f on f.id=p.from_member join public.group_members t on t.id=p.to_member where p.session_id=sid and p.status='cancelled';
 return result;
end $$;
revoke all on function public.replaced_payments(uuid) from public,anon,service_role;
grant execute on function public.replaced_payments(uuid) to authenticated;
