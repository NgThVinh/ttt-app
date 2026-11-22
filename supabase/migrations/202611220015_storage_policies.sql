do $$declare bucket text;begin
 if to_regclass('storage.buckets') is not null then
 foreach bucket in array array['3t-payment-evidence','3t-expense-receipts'] loop
 if exists(select 1 from storage.buckets where id=bucket and (public or file_size_limit is distinct from 2097152::bigint or allowed_mime_types is distinct from array['image/jpeg','image/png','image/webp'])) then raise exception 'Existing receipt bucket configuration conflicts';end if;
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values(bucket,bucket,false,2097152,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
 end loop;
 create policy ttt_receipt_read on storage.objects for select to authenticated using(bucket_id in ('3t-payment-evidence','3t-expense-receipts') and public.can_read_receipt_file(bucket_id,name));
 create policy ttt_receipt_upload on storage.objects for insert to authenticated with check(bucket_id in ('3t-payment-evidence','3t-expense-receipts') and public.can_upload_receipt_file(bucket_id,name));
 create policy ttt_receipt_read_guard on storage.objects as restrictive for select to authenticated using(bucket_id not in ('3t-payment-evidence','3t-expense-receipts') or public.can_read_receipt_file(bucket_id,name));
 create policy ttt_receipt_upload_guard on storage.objects as restrictive for insert to authenticated with check(bucket_id not in ('3t-payment-evidence','3t-expense-receipts') or public.can_upload_receipt_file(bucket_id,name));
 create policy ttt_receipt_no_overwrite on storage.objects as restrictive for update to authenticated using(bucket_id not in ('3t-payment-evidence','3t-expense-receipts')) with check(bucket_id not in ('3t-payment-evidence','3t-expense-receipts'));
 create policy ttt_receipt_no_delete on storage.objects as restrictive for delete to authenticated using(bucket_id not in ('3t-payment-evidence','3t-expense-receipts'));
 create policy ttt_receipt_no_anon on storage.objects as restrictive for all to anon using(bucket_id not in ('3t-payment-evidence','3t-expense-receipts')) with check(bucket_id not in ('3t-payment-evidence','3t-expense-receipts'));
 end if;
end $$;
