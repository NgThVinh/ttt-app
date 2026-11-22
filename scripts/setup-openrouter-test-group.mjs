import pg from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { databaseUrlForProject } from "./migration-utils.mjs";
import { encryptGroupKey } from "../src/lib/ai/crypto.ts";
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
});
let transaction = false;
try {
  if (!process.env.OPENROUTER_API_KEY || !process.env.AI_KEY_ENCRYPTION_SECRET)
    throw Object.assign(new Error(), { code: "MISSING_TEST_CREDENTIALS" });
  const saved = JSON.parse(readFileSync(".tools/ai-test-group.json", "utf8"));
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: "Bearer " + process.env.OPENROUTER_API_KEY },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw Object.assign(new Error(), { code: "MODEL_LIST_" + response.status });
  const { data: models } = await response.json();
  const preferred =
    process.env.OPENROUTER_TEST_MODEL || "google/gemma-4-31b-it:free";
  const model = models.find(
    (m) => m.id === preferred && m.supported_parameters?.includes("tools"),
  );
  if (!model)
    throw Object.assign(new Error(), { code: "MODEL_WITH_TOOLS_UNAVAILABLE" });
  if (model.pricing?.prompt !== "0" || model.pricing?.completion !== "0")
    throw Object.assign(new Error(), { code: "TEST_MODEL_MUST_BE_FREE" });
  await db.connect();
  await db.query("begin");
  transaction = true;
  const owner = (
    await db.query(
      "select u.id from public.groups g join auth.users u on u.id=g.created_by join app_private.super_admin_allowlist a on a.email=lower(trim(u.email)) and a.active where g.id=$1 and g.name='3T · Kiểm thử AI' and u.email_confirmed_at is not null",
      [saved.groupId],
    )
  ).rows[0];
  if (!owner)
    throw Object.assign(new Error(), {
      code: "AUTHORIZED_TEST_GROUP_REQUIRED",
    });
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    owner.id,
  ]);
  await db.query("set local role authenticated");
  const current = (
    await db.query(
      "select revision,message_limit,token_limit from public.group_ai_settings where group_id=$1",
      [saved.groupId],
    )
  ).rows[0];
  await db.query("select public.configure_group_ai($1,$2,$3,$4)", [
    saved.groupId,
    current.revision,
    JSON.stringify({
      status: "approved",
      provider: "openai-compatible",
      model: model.id,
      base_url: "https://openrouter.ai/api/v1",
      suffix: process.env.OPENROUTER_API_KEY.slice(-4),
      message_limit: current.message_limit,
      token_limit: current.token_limit,
      enabled: true,
      reason:
        "Chuyển nhóm nghiệm thu sang OpenRouter theo chỉ định của chủ ứng dụng",
    }),
    JSON.stringify(
      encryptGroupKey(
        saved.groupId,
        process.env.OPENROUTER_API_KEY,
        process.env.AI_KEY_ENCRYPTION_SECRET,
      ),
    ),
  ]);
  await db.query("commit");
  transaction = false;
  let env = readFileSync(".env", "utf8");
  const allowed = (process.env.AI_ALLOWED_COMPATIBLE_HOSTS || "api.openai.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes("openrouter.ai")) allowed.push("openrouter.ai");
  const entry = "AI_ALLOWED_COMPATIBLE_HOSTS=" + allowed.join(",");
  env = /^AI_ALLOWED_COMPATIBLE_HOSTS=.*$/m.test(env)
    ? env.replace(/^AI_ALLOWED_COMPATIBLE_HOSTS=.*$/m, entry)
    : env + "\n" + entry + "\n";
  writeFileSync(".env", env);
  console.log(
    JSON.stringify({
      configured: true,
      groupId: saved.groupId,
      provider: "openai-compatible",
      model: model.id,
      encrypted: true,
      free: model.pricing?.prompt === "0" && model.pricing?.completion === "0",
    }),
  );
} catch (error) {
  if (transaction) await db.query("rollback").catch(() => {});
  console.error(JSON.stringify({ code: error.code || error.name }));
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
