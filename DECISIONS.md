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
- Group creation uses a dedicated service-role-only provisioning RPC, called exclusively after a fresh server-side verified-email check against SUPER_ADMIN_EMAILS. This client is not available to AI tools. Group membership, invitations and role changes use the actor's JWT and guarded database functions.
- Generic invitations create a fresh membership. Claiming a guest member requires admin approval; the guest ID and its financial history remain intact. If the fresh membership already has session/financial references, automatic merging is rejected to avoid dropping history. An admin cannot claim while retaining the admin role of the fresh membership.
- The last active admin cannot be demoted or removed. A removed user cannot rejoin with a generic invite. Admin changes serialize on the group row; invitation acceptance locks the invitation row before consuming a use.
- Approval requests now include the `member_claim` type. Payload hashes are computed in PostgreSQL, approvals expire after 72 hours, and decisions require an active group admin. Other approval types remain unimplemented.
- PGlite runs actual PostgreSQL RLS and migration tests with Auth role fixtures. The initial pgcrypto extension declaration is omitted in the embedded harness because it is unused by tested migrations; hosted integration still requires separate verification.
