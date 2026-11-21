# 3T — Thích Tính Tiền

Vietnamese sports group expense tracker. **Implementation in progress; not ready for real financial records.**

## Local development

Use Node.js 24 LTS. Run `npm ci`, `npm run dev`, then visit http://localhost:3000. Copy `.env.example` to `.env` only when an environment file does not already exist. Never commit credentials.

Commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

Hosted database: all 10 migrations were applied on 2026-11-22; all 13 business tables have RLS. Hosted permission/accounting smoke checks passed in a rolled-back transaction, preserving existing Auth users and leaving no test data. `npm run db:status` inspects migration state; `npm run db:migrate` applies new files atomically; `npm run db:verify` reruns the rollback-only checks. The website and remaining features are not yet deployed or fully accepted.

Implemented: responsive dashboard and demonstration mode, local Hamilton expense calculator, server-side Supabase Google/email authentication, pure bigint allocation/reconciliation with tests, initial RLS migration and guarded payment RPC.

Group management: `/groups` lists memberships and exposes group creation only to the verified super admin. Group pages support expiring/revocable invitations, member roles, soft removal, and admin-approved claims of existing guest members. `/me` saves private bank/profile information. Invite destinations survive Google and email authentication; return URLs are allowlisted.

Tests now execute migrations and RLS against embedded PostgreSQL (PGlite) with a minimal Supabase Auth identity fixture. This exercises database permissions and transactions without Docker; it does not replace hosted Auth, Storage, Realtime, concurrency, or full permission-matrix acceptance tests.

Sessions: `/sessions/new` creates played sessions with reviewed allocation previews or future sessions with self RSVP. `/sessions/[id]` supports claiming an unassigned collector role, finalizing attendance, expense breakdowns, collector-entered extras/discounts with all four split modes, and sender/receiver payment actions. Collector changes to attendance, weights and expense deletion have database-backed previews that roll back all writes, followed by an explicit save against the reviewed revision. Confirmed transfers remain immutable and corrections create new collections/refunds.

`/debts` and the home totals read actual personal settlements with money encoded as decimal strings. Payment screens show recipient bank details and copy buttons. QR images require an operator-owned VietQR template; see `.env.example` and DEPLOY.md.

Approvals: `/approvals` lists pending session requests addressed to the current member and requests they sent. Attendance/weight requests and shared expense proposals require the current collector's explicit app approval against a preview, immutable payload hash and session revision. Participant-only extras activate directly. Collector nomination requires the existing collector's consent when initiated by the session creator, followed by the nominee's separate acceptance with bank details. Confirmed payments are preserved when collection responsibility moves. Requests expire after 72 hours, can be rejected or withdrawn, and are rate limited to 20 per user per day. History includes actor names and attendance events.

Pending: session metadata editing/cancellation, admin fallback/unlock, editable existing extras/proposals, categories/templates, receipt storage, scheduling, notifications, AI, full PWA support and hosted deployment. Hosted end-to-end and concurrent execution remain unverified. Stale requests must be withdrawn and resubmitted; they are not silently rebased. The canonical requirements are in `docs/handoff_prompt.md`.

See DEPLOY.md for infrastructure prerequisites and DECISIONS.md for design choices.
