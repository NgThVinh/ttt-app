import pg from "pg";
import { readFileSync } from "node:fs";
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
  if (!process.env.GEMINI_API_KEY || !process.env.AI_KEY_ENCRYPTION_SECRET)
    throw Error("MISSING_CREDENTIALS");
  const { groupId } = JSON.parse(
    readFileSync(".tools/ai-test-group.json", "utf8"),
  );
  await db.connect();
  await db.query("begin");
  transaction = true;
  const owner = (
    await db.query(
      "select u.id from public.groups g join auth.users u on u.id=g.created_by join app_private.super_admin_allowlist a on a.email=lower(trim(u.email)) and a.active where g.id=$1 and g.name='3T · Kiểm thử AI' and u.email_confirmed_at is not null",
      [groupId],
    )
  ).rows[0];
  if (!owner) throw Error("AUTHORIZED_TEST_GROUP_REQUIRED");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    owner.id,
  ]);
  await db.query("set local role authenticated");
  const current = (
    await db.query(
        "select * from public.group_ai_settings where group_id=$1",
      [groupId],
    )
  ).rows[0];
  if (current.decision_model) {
    await db.query("select public.configure_group_decisions($1,$2,null,$3)", [
      groupId,
      current.revision,
      "Chuyển nhóm test về Gemini theo yêu cầu chủ ứng dụng",
    ]);
  }
  const revision = (
    await db.query(
      "select revision from public.group_ai_settings where group_id=$1",
      [groupId],
    )
  ).rows[0].revision;
  await db.query("select public.configure_group_ai($1,$2,$3,$4)", [
    groupId,
    revision,
    JSON.stringify({
      status: "approved",
      enabled: true,
      provider: "google",
      model: "gemini-3.5-flash-lite",
      base_url: "",
      suffix: process.env.GEMINI_API_KEY.slice(-4),
      message_limit: Math.min(current.message_limit, 20),
      token_limit: Math.min(current.token_limit, 100000),
      reason:
        "Quay lại Gemini đã probe thành công; dùng tiết kiệm theo yêu cầu chủ ứng dụng",
    }),
    JSON.stringify(
      encryptGroupKey(
        groupId,
        process.env.GEMINI_API_KEY,
        process.env.AI_KEY_ENCRYPTION_SECRET,
      ),
    ),
  ]);
  await db.query("commit");
  transaction = false;
  console.log(
    JSON.stringify({
      configured: true,
      provider: "google",
      model: "gemini-3.5-flash-lite",
      encrypted: true,
      testGroupOnly: true,
      messageLimit: Math.min(current.message_limit, 20),
      tokenLimit: Math.min(current.token_limit, 100000),
    }),
  );
} catch (error) {
  if (transaction) await db.query("rollback").catch(() => {});
  console.error(JSON.stringify({ code: error.code || error.message }));
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
