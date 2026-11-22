create function public.cleanup_storage_files() returns void language plpgsql security definer set search_path='' as $$
declare api_key text;base_url text;job record;response_status integer;
begin
 if to_regclass('vault.decrypted_secrets') is null or to_regtype('extensions.http_request') is null then return;end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where name=''3t_storage_cleanup_key''' into api_key;
 execute 'select decrypted_secret from vault.decrypted_secrets where name=''3t_storage_cleanup_url''' into base_url;
 if api_key is null or base_url is null then return;end if;
 if not pg_try_advisory_xact_lock(hashtextextended('3t-storage-cleanup',0)) then return;end if;
 execute 'select extensions.http_set_curlopt(''CURLOPT_CONNECTTIMEOUT_MS'',''2000'')';
 execute 'select extensions.http_set_curlopt(''CURLOPT_TIMEOUT_MS'',''5000'')';
 for job in select * from public.claim_storage_cleanup() loop
 response_status:=null;
 begin
 execute $http$select status from extensions.http(('DELETE',$1||'/storage/v1/object/'||$3,array[extensions.http_header('apikey',$2),extensions.http_header('Authorization','Bearer '||$2)],'application/json',jsonb_build_object('prefixes',jsonb_build_array($4))::text)::extensions.http_request)$http$ into response_status using base_url,api_key,job.bucket,job.path;
 exception when others then response_status:=null;end;
 perform public.finish_storage_cleanup(job.id,job.lease_token,coalesce(response_status between 200 and 299 or response_status=404,false));
 end loop;
end $$;
revoke all on function public.cleanup_storage_files() from public,anon,authenticated;
