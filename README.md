# 3T — Thích Tính Tiền

Vietnamese sports group expense tracker. **Implementation in progress; not ready for real financial records.**

## Local development

Use Node.js 24 LTS. Run `npm ci`, `npm run dev`, then visit http://localhost:3000. Copy `.env.example` to `.env` only when an environment file does not already exist. Never commit credentials.

Commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

Implemented: responsive dashboard and demonstration mode, local Hamilton expense calculator, server-side Supabase Google/email authentication, pure bigint allocation/reconciliation with tests, initial RLS migration and guarded payment RPC.

Group management: `/groups` lists memberships and exposes group creation only to the verified super admin. Group pages support expiring/revocable invitations, member roles, soft removal, and admin-approved claims of existing guest members. `/me` saves private bank/profile information. Invite destinations survive Google and email authentication; return URLs are allowlisted.

Tests now execute migrations and RLS against embedded PostgreSQL (PGlite) with a minimal Supabase Auth identity fixture. This exercises database permissions and transactions without Docker; it does not replace hosted Auth, Storage, Realtime, concurrency, or full permission-matrix acceptance tests.

Pending: session editing/creation UI and RPCs, all split modes, remaining approval workflows, actual debt dashboard, receipt storage, scheduling, notifications, AI, full PWA support and deployment. The current UI labels incomplete data paths and does not claim financial writes succeeded. The canonical requirements are in `docs/handoff_prompt.md`.

See DEPLOY.md for infrastructure prerequisites and DECISIONS.md for design choices.
