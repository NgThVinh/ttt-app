import pg from "pg";
import { readFileSync } from "node:fs";
import { databaseUrlForProject } from "./migration-utils.mjs";
import { isFreeDecisionModel } from "../src/lib/ai/harness/decision-router.mjs";
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
const db = new pg.Client({
  connectionString: databaseUrlForProject(
    process.env.SUPABASE_DB_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  ssl: {
    ca: readFileSync(
      new URL("../supabase/certs/prod-ca-2021.crt", import.meta.url),
      "utf8",
    ),
    rejectUnauthorized: true,
  },
  connectionTimeoutMillis: 15000,
  query_timeout: 15000,
});
let transaction = false;
try {
  const { groupId } = JSON.parse(
    readFileSync(".tools/ai-test-group.json", "utf8"),
  );
  const model = "perplexity/pplx-decider-flash-v1.3:free";
  const response = await fetch(
    "https://openrouter.ai/api/v1/models?output_modalities=all",
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) throw Error("CATALOG_UNAVAILABLE");
  const { data } = await response.json();
  if (!data.some((m) => m.id === model && isFreeDecisionModel(m)))
    throw Error("FREE_DECISION_MODEL_UNAVAILABLE");
  await db.connect();
  await db.query("begin");
  transaction = true;
  const row = (
    await db.query(
      "select s.revision,g.created_by from public.group_ai_settings s join public.groups g on g.id=s.group_id join auth.users u on u.id=g.created_by join app_private.super_admin_allowlist a on a.email=lower(trim(u.email)) and a.active where g.id=$1 and g.name='3T · Kiểm thử AI' and u.email_confirmed_at is not null",
      [groupId],
    )
  ).rows[0];
  if (!row) throw Error("VERIFIED_TEST_GROUP_OWNER_REQUIRED");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    row.created_by,
  ]);
  await db.query("set local role authenticated");
  await db.query("select public.configure_group_decisions($1,$2,$3,$4)", [
    groupId,
    row.revision,
    model,
    "Bật định tuyến decision model cho nhóm nghiệm thu theo chỉ định của chủ ứng dụng",
  ]);
  await db.query("commit");
  transaction = false;
  console.log(
    JSON.stringify({
      enabled: true,
      groupId,
      decisionModel: model,
      otherGroupsChanged: false,
    }),
  );
} catch (error) {
  if (transaction) await db.query("rollback").catch(() => {});
  console.error(
    JSON.stringify({ code: error.code || error.message || error.name }),
  );
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
