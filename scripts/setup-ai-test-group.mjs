import pg from "pg";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
    throw Object.assign(new Error(), { code: "MISSING_TEST_CREDENTIALS" });
  await db.connect();
  const owner = (
    await db.query(
      "select u.id from auth.users u join app_private.super_admin_allowlist a on a.email=lower(trim(u.email)) and a.active where u.email_confirmed_at is not null order by u.created_at limit 1",
    )
  ).rows[0];
  if (!owner)
    throw Object.assign(new Error(), { code: "VERIFIED_OWNER_REQUIRED" });
  mkdirSync(".tools", { recursive: true });
  const path = ".tools/ai-test-group.json",
    saved = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : { requestKey: randomUUID() };
  writeFileSync(path, JSON.stringify(saved));
  await db.query("begin");
  transaction = true;
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    owner.id,
  ]);
  await db.query("set local role authenticated");
  const g = (
    await db.query(
      "select public.create_group('3T · Kiểm thử AI','Kiểm thử',$1) id",
      [saved.requestKey],
    )
  ).rows[0].id;
  const current = (
    await db.query("select * from public.group_ai_settings where group_id=$1", [
      g,
    ])
  ).rows[0];
  if (current?.status === "approved") {
    await db.query("commit");
    transaction = false;
    writeFileSync(path, JSON.stringify({ ...saved, groupId: g }));
    console.log(JSON.stringify({ configured: true, reused: true, groupId: g }));
  } else {
    if (!current || current.status !== "requested")
      await db.query(
        "select public.request_group_ai($1,'Nhóm riêng để nghiệm thu AI theo sự cho phép của chủ ứng dụng')",
        [g],
      );
    const s = (
      await db.query(
        "select revision from public.group_ai_settings where group_id=$1",
        [g],
      )
    ).rows[0];
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models",
      {
        headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw Object.assign(new Error(), {
        code: "PROVIDER_MODEL_LIST_" + response.status,
      });
    const data = await response.json();
    const names = (data.models || [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace("models/", ""));
    const model = [
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash",
    ].find((m) => names.includes(m));
    if (!model)
      throw Object.assign(new Error(), {
        code: "NO_VERIFIED_STABLE_FLASH_MODEL",
      });
    await db.query("select public.configure_group_ai($1,$2,$3,$4)", [
      g,
      s.revision,
      JSON.stringify({
        status: "approved",
        provider: "google",
        model,
        base_url: "",
        suffix: process.env.GEMINI_API_KEY.slice(-4),
        message_limit: 100,
        token_limit: 1000000,
        enabled: true,
        reason: "Key hiện có chỉ dành riêng nhóm nghiệm thu",
      }),
      JSON.stringify(
        encryptGroupKey(
          g,
          process.env.GEMINI_API_KEY,
          process.env.AI_KEY_ENCRYPTION_SECRET,
        ),
      ),
    ]);
    await db.query("commit");
    transaction = false;
    writeFileSync(path, JSON.stringify({ ...saved, groupId: g }));
    console.log(
      JSON.stringify({ configured: true, groupId: g, model, encrypted: true }),
    );
  }
} catch (error) {
  if (transaction) await db.query("rollback").catch(() => {});
  console.error(JSON.stringify({ code: error.code || error.name }));
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
