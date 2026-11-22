create function public.expire_receipt_files() returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.storage_cleanup_jobs(bucket,path) select '3t-payment-evidence',e.storage_path from public.payment_evidence e join public.settlements p on p.id=e.settlement_id where e.storage_path is not null and e.status<>'expired' and ((p.confirmed_at is not null and p.confirmed_at<=now()-interval '30 days') or (e.status='reserved' and e.created_at<=now()-interval '24 hours')) on conflict(bucket,path) do nothing;
 update public.payment_evidence e set status='expired' from public.settlements p where p.id=e.settlement_id and e.storage_path is not null and ((p.confirmed_at is not null and p.confirmed_at<=now()-interval '30 days') or (e.status='reserved' and e.created_at<=now()-interval '24 hours'));
 insert into public.storage_cleanup_jobs(bucket,path) select '3t-expense-receipts',storage_path from public.expense_receipts where status='reserved' and created_at<=now()-interval '24 hours' on conflict(bucket,path) do nothing;
 update public.expense_receipts set status='expired' where status='reserved' and created_at<=now()-interval '24 hours';
end $$;
create function public.claim_storage_cleanup() returns table(id uuid,bucket text,path text,lease_token uuid) language plpgsql security definer set search_path='' as $$
begin
 return query with candidates as(select j.id from public.storage_cleanup_jobs j where j.status<>'finished' and j.available_at<=now() and (j.lease_until is null or j.lease_until<=now()) order by j.created_at for update skip locked limit 50)
 update public.storage_cleanup_jobs j set status='processing',attempts=attempts+1,lease_until=now()+interval '5 minutes',lease_token=gen_random_uuid() from candidates c where j.id=c.id returning j.id,j.bucket,j.path,j.lease_token;
end $$;
create function public.finish_storage_cleanup(target uuid,token uuid,succeeded boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.storage_cleanup_jobs set status=case when succeeded then 'finished' else 'pending' end,finished_at=case when succeeded then now() else null end,available_at=now()+least(3600,power(2,least(attempts,10))*60)*interval '1 second',lease_until=null,lease_token=null where id=target and lease_token=token and status='processing';
end $$;
revoke all on function public.expire_receipt_files(),public.claim_storage_cleanup(),public.finish_storage_cleanup(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_storage_cleanup(),public.finish_storage_cleanup(uuid,uuid,boolean) to service_role;
alter function public.run_scheduled_jobs() rename to run_scheduled_jobs_before_receipts;
revoke all on function public.run_scheduled_jobs_before_receipts() from public,anon,authenticated;
create function public.run_scheduled_jobs() returns void language plpgsql security definer set search_path='' as $$begin perform public.run_scheduled_jobs_before_receipts();perform public.expire_receipt_files();end $$;
revoke all on function public.run_scheduled_jobs() from public,anon,authenticated;
