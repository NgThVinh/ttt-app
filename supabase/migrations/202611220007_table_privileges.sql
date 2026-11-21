-- Supabase projects can grant broad privileges through default privileges.
-- RLS does not protect TRUNCATE, so revoke it explicitly for all client roles.
revoke truncate,references,trigger on all tables in schema public from anon,authenticated;
create trigger audit_no_truncate before truncate on public.audit_log for each statement execute function public.immutable_log();
create trigger attendance_no_truncate before truncate on public.attendance_events for each statement execute function public.immutable_log();
