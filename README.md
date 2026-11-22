# 3T — Thích Tính Tiền

Vietnamese sports group expense tracker. **Implementation in progress; not ready for real financial records.**

## Local development

Use Node.js 24 LTS. Run `npm ci`, `npm run dev`, then visit http://localhost:3000. Copy `.env.example` to `.env` only when an environment file does not already exist. Never commit credentials.

Commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

Hosted database: all 20 migrations were applied on 2026-11-22; all 21 public tables have RLS. Hosted permission/accounting/scheduling smoke checks run in a rolled-back transaction, preserving existing Auth users and leaving no test business data. `npm run db:status` inspects migration state; `npm run db:migrate` applies new files atomically; `npm run db:verify` reruns the rollback-only checks. The website and remaining features are not yet deployed or fully accepted.

Implemented: responsive dashboard and demonstration mode, local Hamilton expense calculator, server-side Supabase Google/email authentication, pure bigint allocation/reconciliation with tests, initial RLS migration and guarded payment RPC.

Group management: `/groups` lists memberships and exposes group creation only to the verified super admin. Group pages support expiring/revocable invitations, member roles, soft removal, and admin-approved claims of existing guest members. `/me` saves private bank/profile information. Invite destinations survive Google and email authentication; return URLs are allowlisted.

Tests now execute migrations and RLS against embedded PostgreSQL (PGlite) with a minimal Supabase Auth identity fixture. This exercises database permissions and transactions without Docker; it does not replace hosted Auth, Storage, Realtime, concurrency, or full permission-matrix acceptance tests.

Sessions: `/sessions/new` creates played sessions with reviewed allocation previews or future sessions with self RSVP. `/sessions/[id]` supports claiming an unassigned collector role, finalizing attendance, expense breakdowns, collector-entered extras/discounts with all four split modes, and sender/receiver payment actions. Collector changes to attendance, weights and expense deletion have database-backed previews that roll back all writes, followed by an explicit save against the reviewed revision. Confirmed transfers remain immutable and corrections create new collections/refunds.

Calendar management: the creator, current collector or group admin can edit the title, venue and general note with a reason. Changing start/deadline is permitted only for planned sessions before the original deadline, with a future new deadline; existing RSVP choices reset and members must self-confirm again. Reminder stages are deduplicated per schedule generation, preserving existing reminder keys for unchanged sessions. Sessions with any nonzero expense history or any transfer cannot be cancelled through calendar management. Money-free cancellation preserves history and cancels pending requests; reopening requires a future deadline and fresh self commitments. Changes apply to one weekly instance, notify the group, and check the session revision. Settled sessions older than 30 days remain locked pending admin unlock implementation.

`/debts` and the home totals read actual personal settlements with money encoded as decimal strings. Payment screens show recipient bank details and copy buttons. QR images require an operator-owned VietQR template; see `.env.example` and DEPLOY.md.

Approvals: `/approvals` lists pending session requests addressed to the current member and requests they sent. Attendance/weight requests and shared expense proposals require the current collector's explicit app approval against a preview, immutable payload hash and session revision. Participant-only extras activate directly. Collector nomination requires the existing collector's consent when initiated by the session creator, followed by the nominee's separate acceptance with bank details. Confirmed payments are preserved when collection responsibility moves. Requests expire after 72 hours, can be rejected or withdrawn, and are rate limited to 20 per user per day. History includes actor names and attendance events.

Scheduling: `/polls` creates multi-slot polls; votes are updated under the voter's identity. Creators/admins close a qualifying slot exactly once, producing a planned session with no collector and no automatic attendance commitments. `/notifications` is private to the recipient. Polls/notifications subscribe to Supabase Realtime with focus/30-second refresh fallback. Session and poll pages offer native sharing/clipboard fallback for Messenger without bank data.

Weekly sessions generate up to four weeks ahead, for 1–12 configured weeks; new instances have no collector or committed attendees. The hosted `3t-minute-maintenance` cron runs every minute for deadline finalization, reminder schedules, request expiry, weekly generation, admin escalation and receipt expiry. `npm run db:cron` shows both jobs and latest runs; `npm run db:cron:install` installs the minute job. Notifications are in-app only so far; Web Push is pending.

Receipts: senders can attach payment screenshots, transaction references or notes; expense authors/collectors can attach invoices. Images are resized/re-encoded in the browser and uploaded using the user's Storage permissions to private image-only buckets (2 MiB limit). Proofs are readable only by active sender/receiver/group admins; invoices by group members. Viewing uses 60-second signed links. Proof images become inaccessible 30 days after confirmation and are queued for physical deletion; business metadata remains. Uploading evidence never confirms payment. Abandoned upload reservations expire after 24 hours. The hosted `3t-storage-cleanup` job deletes queued objects through Storage API every five minutes, with leases/retries and credentials in Supabase Vault. `npm run db:storage:install` configures it; `npm run db:storage:verify` uploads/removes one generated fixture to check actual API deletion and anonymous denial. All 72 automated tests pass; browser upload acceptance remains pending.

Pending: admin fallback/unlock, editable existing extras/proposals, categories/templates, Web Push, manual reminder controls, AI, full PWA support and hosted deployment. Browser end-to-end, websocket delivery and concurrent execution remain unverified. Stale requests must be withdrawn and resubmitted; they are not silently rebased. The canonical requirements are in `docs/handoff_prompt.md`.

See DEPLOY.md for infrastructure prerequisites and DECISIONS.md for design choices.
