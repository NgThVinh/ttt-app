import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { createHash, X509Certificate } from "node:crypto";
import { fileURLToPath } from "node:url";
import { databaseUrlForProject } from "./migration-utils.mjs";

// CLI only. Credentials are loaded from .env, never passed as command arguments.
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
const apply = process.argv.includes("--apply");
let client;
let inTransaction = false;
let stage = "configuration";
try {
  const connectionString = databaseUrlForProject(
    process.env.SUPABASE_DB_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const ca = readFileSync(
    process.env.SUPABASE_DB_CA_CERT ||
      fileURLToPath(
        new URL("../supabase/certs/prod-ca-2021.crt", import.meta.url),
      ),
    "utf8",
  );
  const certificate = new X509Certificate(ca);
  if (new Date(certificate.validTo) < new Date())
    throw Object.assign(new Error(), { code: "CA_EXPIRED" });
  client = new pg.Client({
    connectionString,
    ssl: { ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 15000,
    query_timeout: 60000,
    application_name: "3t-migrations",
  });
  await client.connect();
  stage = "preflight";
  const folder = new URL("../supabase/migrations/", import.meta.url);
  const files = readdirSync(folder)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const local = files.map((file) => {
    const sql = readFileSync(new URL(file, folder), "utf8").replace(
      /^\uFEFF/,
      "",
    );
    return {
      file,
      version: file.split("_")[0],
      name: file.replace(/^\d+_/, "").replace(/\.sql$/, ""),
      sql,
      hash: createHash("sha256").update(sql).digest("hex"),
    };
  });
  if (new Set(local.map((m) => m.version)).size !== local.length)
    throw Object.assign(new Error(), { code: "DUPLICATE_VERSION" });
  await client.query("begin");
  inTransaction = true;
  await client.query("set local lock_timeout='10s'");
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended('3t-schema-migrations',0))",
  );
  const historyExists = (
    await client.query(
      "select to_regclass('supabase_migrations.schema_migrations') is not null present",
    )
  ).rows[0].present;
  const history = historyExists
    ? (
        await client.query(
          "select version from supabase_migrations.schema_migrations order by version",
        )
      ).rows
    : [];
  if (history.some((h) => !local.some((m) => m.version === h.version)))
    throw Object.assign(new Error(), { code: "UNKNOWN_REMOTE_HISTORY" });
  const tables = (
    await client.query(
      "select tablename from pg_tables where schemaname='public' order by tablename",
    )
  ).rows.map((r) => r.tablename);
  if (!history.length && tables.length)
    throw Object.assign(new Error(), { code: "UNTRACKED_EXISTING_SCHEMA" });
  if (!history.length) {
    const objects = await client.query(
      "select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') union all select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m','S')",
    );
    if (objects.rowCount)
      throw Object.assign(new Error(), { code: "UNTRACKED_EXISTING_OBJECTS" });
  }
  const checksumsExist = (
    await client.query(
      "select to_regclass('supabase_migrations.ttt_checksums') is not null present",
    )
  ).rows[0].present;
  if (checksumsExist) {
    for (const row of (
      await client.query(
        "select version,sha256 from supabase_migrations.ttt_checksums",
      )
    ).rows) {
      if (local.find((m) => m.version === row.version)?.hash !== row.sha256)
        throw Object.assign(new Error(), { code: "APPLIED_MIGRATION_CHANGED" });
    }
  }
  const pending = local.filter(
    (m) => !history.some((h) => h.version === m.version),
  );
  console.log(
    JSON.stringify({
      projectMatches: true,
      verifiedTLS: true,
      caFingerprint: certificate.fingerprint256,
      applied: history.length,
      pending: pending.map((m) => m.file),
      publicTables: tables,
    }),
  );
  if (!apply) {
    await client.query("rollback");
    inTransaction = false;
    console.log("Read-only preflight complete.");
  } else {
    await client.query("create schema if not exists supabase_migrations");
    await client.query(
      "create table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text)",
    );
    await client.query(
      "create table if not exists supabase_migrations.ttt_checksums(version text primary key references supabase_migrations.schema_migrations(version),sha256 text not null)",
    );
    await client.query(
      "revoke all on schema supabase_migrations from public,anon,authenticated",
    );
    await client.query(
      "revoke all on all tables in schema supabase_migrations from public,anon,authenticated",
    );
    for (const m of pending) {
      stage = m.file;
      await client.query(m.sql);
      await client.query(
        "insert into supabase_migrations.schema_migrations(version,statements,name) values($1,$2,$3)",
        [m.version, [m.sql], m.name],
      );
      await client.query(
        "insert into supabase_migrations.ttt_checksums(version,sha256) values($1,$2)",
        [m.version, m.hash],
      );
      console.log(`Applied ${m.file}`);
    }
    stage = "verification";
    const noRls = (
      await client.query(
        "select tablename from pg_tables where schemaname='public' and not rowsecurity",
      )
    ).rows;
    if (noRls.length)
      throw Object.assign(new Error(), { code: "RLS_NOT_ENABLED" });
    await client.query("notify pgrst, 'reload schema'");
    await client.query("commit");
    inTransaction = false;
    console.log(
      JSON.stringify({
        committed: true,
        newMigrations: pending.length,
        rlsVerified: true,
      }),
    );
  }
} catch (error) {
  if (inTransaction) await client?.query("rollback").catch(() => {});
  console.error(
    JSON.stringify({
      stage,
      errorCode: error.code || error.name,
      rolledBack: inTransaction,
    }),
  );
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
