alter function public.run_scheduled_jobs() rename to run_scheduled_jobs_core;
revoke all on function public.run_scheduled_jobs_core() from public,anon,authenticated;
create function public.run_scheduled_jobs() returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.run_scheduled_jobs_core();
 if to_regclass('cron.job_run_details') is not null then
 execute 'delete from cron.job_run_details where jobid in (select jobid from cron.job where jobname=''3t-minute-maintenance'') and end_time<now()-interval ''7 days''';
 end if;
end $$;
revoke all on function public.run_scheduled_jobs() from public,anon,authenticated;
