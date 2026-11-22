import pg from "pg";
import { readFileSync } from "node:fs";
import { databaseUrlForProject } from "./migration-utils.mjs";
import { parseSuperAdminEmails } from "../src/lib/super-admin-config.mjs";

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
const apply = process.argv.includes("--apply");
let transaction = false;
try {
  const emails = parseSuperAdminEmails(
    process.env.SUPER_ADMIN_EMAILS,
    process.argv.includes("--allow-empty"),
  );
  await db.connect();
  await db.query("begin");
  transaction = true;
  await db.query(
    "select pg_advisory_xact_lock(hashtextextended('3t-super-admin-sync',0))",
  );
  const before = (
    await db.query(
      "select count(*)::int n from app_private.super_admin_allowlist where active",
    )
  ).rows[0].n;
  const changes = (
    await db.query(
      "with desired as(select unnest($1::text[]) email), current_list as(select email from app_private.super_admin_allowlist where active) select count(*)::int n from desired d full join current_list c using(email) where d.email is null or c.email is null",
      [emails],
    )
  ).rows[0].n;
  if (apply) {
    await db.query(
      "insert into app_private.super_admin_allowlist(email,active,synced_at) select unnest($1::text[]),true,now() on conflict(email) do update set active=true,synced_at=now()",
      [emails],
    );
    await db.query(
      "update app_private.super_admin_allowlist set active=false,synced_at=now() where active and not(email=any($1::text[]))",
      [emails],
    );
  }
  const verified = (
    await db.query(
      "select count(distinct lower(trim(email)))::int n from auth.users where email_confirmed_at is not null and lower(trim(email))=any($1::text[])",
      [emails],
    )
  ).rows[0].n;
  await db.query(apply ? "commit" : "rollback");
  transaction = false;
  console.log(
    JSON.stringify({
      applied: apply,
      previousActive: before,
      configured: emails.length,
      changedEntries: changes,
      verifiedConfiguredAccounts: verified,
    }),
  );
} catch (error) {
  if (transaction) await db.query("rollback").catch(() => {});
  console.error(JSON.stringify({ code: error.code || error.name }));
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
