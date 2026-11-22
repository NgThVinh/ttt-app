import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { databaseUrlForProject } from "./migration-utils.mjs";
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
const db = new pg.Client({
  connectionString: databaseUrlForProject(
    process.env.SUPABASE_DB_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  ssl: {
    ca: readFileSync(
      process.env.SUPABASE_DB_CA_CERT ||
        new URL("../supabase/certs/prod-ca-2021.crt", import.meta.url),
      "utf8",
    ),
    rejectUnauthorized: true,
  },
  connectionTimeoutMillis: 15000,
});
let transaction = false;
try {
  if (!process.env.SUPABASE_SECRET_KEY)
    throw Object.assign(new Error(), { code: "SUPABASE_SECRET_KEY_MISSING" });
  await db.connect();
  const storage = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  if ((await storage.storage.getBucket("3t-payment-evidence")).error)
    throw Object.assign(new Error(), { code: "STORAGE_AUTH_CHECK_FAILED" });
  const exposed = (
    await db.query(
      "select has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') or has_table_privilege('anon','vault.decrypted_secrets','SELECT') exposed",
    )
  ).rows[0].exposed;
  if (exposed)
    throw Object.assign(new Error(), {
      code: "VAULT_CLIENT_ACCESS_MUST_BE_REVOKED",
    });
  await db.query("begin");
  transaction = true;
  await db.query(
    "select pg_advisory_xact_lock(hashtextextended('3t-storage-install',0))",
  );
  await db.query("create extension if not exists http with schema extensions");
  if (
    !(await db.query("select to_regclass('vault.secrets') present")).rows[0]
      .present
  )
    throw Object.assign(new Error(), { code: "SUPABASE_VAULT_REQUIRED" });
  for (const [name, value] of [
    ["3t_storage_cleanup_key", process.env.SUPABASE_SECRET_KEY],
    [
      "3t_storage_cleanup_url",
      new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin,
    ],
  ]) {
    const row = (
      await db.query("select id from vault.secrets where name=$1", [name])
    ).rows[0];
    if (row)
      await db.query("select vault.update_secret($1,$2,$3)", [
        row.id,
        value,
        name,
      ]);
    else await db.query("select vault.create_secret($1,$2)", [value, name]);
  }
  const existing = (
    await db.query(
      "select command from cron.job where jobname='3t-storage-cleanup'",
    )
  ).rows;
  if (
    existing.some((j) => j.command !== "select public.cleanup_storage_files();")
  )
    throw Object.assign(new Error(), { code: "EXISTING_JOB_CONFLICT" });
  await db.query(
    "select cron.schedule('3t-storage-cleanup','*/5 * * * *','select public.cleanup_storage_files();')",
  );
  await db.query("commit");
  transaction = false;
  console.log(
    JSON.stringify({
      installed: true,
      vaultSecretsConfigured: true,
      jobs: (
        await db.query(
          "select jobname,schedule,active from cron.job where jobname='3t-storage-cleanup'",
        )
      ).rows,
    }),
  );
} catch (error) {
  if (transaction) await db.query("rollback").catch(() => {});
  console.error(JSON.stringify({ code: error.code || error.name }));
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
