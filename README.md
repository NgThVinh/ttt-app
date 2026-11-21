# 3T — Thích Tính Tiền

Vietnamese sports group expense tracker. **Implementation in progress; not ready for real financial records.**

## Local development

Use Node.js 24 LTS. Run `npm ci`, `npm run dev`, then visit http://localhost:3000. Copy `.env.example` to `.env` only when an environment file does not already exist. Never commit credentials.

Commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

Implemented: responsive dashboard and demonstration mode, local Hamilton expense calculator, server-side Supabase Google/email authentication, pure bigint allocation/reconciliation with tests, initial RLS migration and guarded payment RPC.

Pending: full group/invite management, session editing/creation UI and RPCs, all split modes, approval workflows, actual debt dashboard, receipt storage, scheduling, notifications, AI, full PWA support and deployment. The current UI labels incomplete data paths and does not claim financial writes succeeded.

See DEPLOY.md for infrastructure prerequisites and DECISIONS.md for design choices.
