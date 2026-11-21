# Deployment status and prerequisites

This checkout has not been deployed. Core, group and member-claim migrations have passed embedded PostgreSQL tests with Auth role fixtures. They have not been applied to the hosted Supabase project. Do not use production financial data yet.

1. Obtain Supabase management access and inspect existing schema before applying migrations. Never reset an existing remote project. Run SQL/RLS integration tests against an isolated local Supabase instance first; Docker must be running.
2. Configure the Supabase URL and publishable key from `.env.example`.
3. Enable Google OAuth in Supabase. Put Google client credentials in Supabase settings. Set the Google redirect to the Supabase auth callback; allow the app's `/auth/callback` URL in Supabase redirect settings.
4. Configure custom SMTP for email magic links. Default Supabase SMTP only delivers to project team members and is unsuitable for normal users. See https://supabase.com/docs/guides/auth/auth-smtp.
5. Set `NEXT_PUBLIC_APP_URL` to the actual application origin. Start with a Vercel Hobby `*.vercel.app` deployment. Run all checks and `npm run build` before publishing. Hosting credentials are not currently connected.
6. Complete remaining implementation and RLS acceptance tests before enabling production use. AI must remain disabled until per-group key encryption, approvals and live evaluations are complete.

Group setup: apply all SQL migrations in timestamp order after inspecting existing data. Set `SUPER_ADMIN_EMAILS` to comma-separated verified owner emails. `SUPABASE_SECRET_KEY` is required on the server only for group provisioning; obtain the secret key from the selected Supabase project's API settings. Group administration and invites use normal user sessions. After signing in as an allowed owner, open `/groups` to create the first group. Invitation URLs use `NEXT_PUBLIC_APP_URL`, so set the actual trusted origin before sharing. Do not add a wildcard redirect to Supabase Auth; permit the exact app callback origin/path. Account claims are reviewed by group admins in the group page.

Future scheduled work will use Supabase Cron for minute-level tasks; Vercel Hobby cron is daily. Secrets for jobs belong in server configuration/Vault. Free Supabase has 500 MB database and 1 GB Storage; heartbeat requests do not guarantee avoiding automatic pausing. See https://supabase.com/pricing, https://supabase.com/docs/guides/platform/free-project-pausing and https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing.

Session migrations: apply through `202611220007_table_privileges.sql` in order. The financial RPCs and transactional previews have embedded PostgreSQL integration coverage; hosted migration, browser end-to-end and concurrency checks are still required. Keep production use disabled until remaining permissions and approval workflows pass the complete handoff matrix.

VietQR: configure `NEXT_PUBLIC_VIETQR_TEMPLATE` with an operator-owned production Quick Link template after reviewing current provider requirements. Account numbers over 19 characters, amounts over 13 digits, an unset template, or an unavailable image use the copy-details fallback. `3T-{ref_code}` is a stable payment reference prefix regardless of the UI app name. The receiver must check their bank statement and manually confirm receipt; QR generation never changes payment status. Source: https://www.vietqr.io/qr-dong.
