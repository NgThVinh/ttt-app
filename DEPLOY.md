# Deployment status and prerequisites

This checkout has not been deployed. The initial migration has not been applied or tested against PostgreSQL. Do not use production financial data yet.

1. Obtain Supabase management access and inspect existing schema before applying migrations. Never reset an existing remote project. Run SQL/RLS integration tests against an isolated local Supabase instance first; Docker must be running.
2. Configure the Supabase URL and publishable key from `.env.example`.
3. Enable Google OAuth in Supabase. Put Google client credentials in Supabase settings. Set the Google redirect to the Supabase auth callback; allow the app's `/auth/callback` URL in Supabase redirect settings.
4. Configure custom SMTP for email magic links. Default Supabase SMTP only delivers to project team members and is unsuitable for normal users. See https://supabase.com/docs/guides/auth/auth-smtp.
5. Set `NEXT_PUBLIC_APP_URL` to the actual application origin. Start with a Vercel Hobby `*.vercel.app` deployment. Run all checks and `npm run build` before publishing. Hosting credentials are not currently connected.
6. Complete remaining implementation and RLS acceptance tests before enabling production use. AI must remain disabled until per-group key encryption, approvals and live evaluations are complete.

Future scheduled work will use Supabase Cron for minute-level tasks; Vercel Hobby cron is daily. Secrets for jobs belong in server configuration/Vault. Free Supabase has 500 MB database and 1 GB Storage; heartbeat requests do not guarantee avoiding automatic pausing. See https://supabase.com/pricing, https://supabase.com/docs/guides/platform/free-project-pausing and https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing.
