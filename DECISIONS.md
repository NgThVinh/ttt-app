# Decisions

- Application identity defaults to `NEXT_PUBLIC_APP_NAME=3T`. UI language is Vietnamese; calendar display uses Asia/Ho_Chi_Minh.
- Money uses bigint internally. API monetary fields must be decimal strings. Live money queries must use text projections, not JSON numbers.
- Hamilton allocation rounds absolute amounts in 1,000 VND units and reapplies the sign. Member IDs break ties deterministically. The payer receives the sub-unit remainder when included.
- Reconciliation subtracts confirmed cash flows from new economic balances. Confirmed records are immutable.
- Database writes are denied by default. The initial payment RPC checks both active membership and the exact sender/receiver. Admin fallback is not enabled until its request age and public-reason checks are implemented.
- Current migration is an initial foundation, not the full handoff schema. Do not treat it as completion of the eight milestones.
- Supabase authentication uses server-side cookies, verified identity, and the current Next.js proxy convention.
- Anonymous landing data is explicitly labeled demonstration data. The calculator is local and creates no payment obligations.
- AI remains disabled: provider configuration, approval workflows, and live evaluation are not yet implemented.
- Meta Send API documentation describes individual Page-scoped recipients. No official group @bot route was found. Group integration will use sharing; DM requires Page/app credentials and App Review. Sources: https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages and https://developers.facebook.com/docs/messenger-platform/getting-started/quick-start.
- Portable Node runtime is ignored under `.tools`. npm lockfile records resolved package versions.
