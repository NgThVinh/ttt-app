import pg from "pg";
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
const apply = process.argv.includes("--apply");
let transaction = false;
try {
  await db.connect();
  const available = (
    await db.query(
      "select installed_version from pg_available_extensions where name='pg_cron'",
    )
  ).rows;
  if (!available.length)
    throw Object.assign(new Error(), { code: "PG_CRON_UNAVAILABLE" });
  if (apply) {
    await db.query("begin");
    transaction = true;
    await db.query(
      "select pg_advisory_xact_lock(hashtextextended('3t-cron-install',0))",
    );
    await db.query(
      "create extension if not exists pg_cron with schema pg_catalog",
    );
    await db.query("grant usage on schema cron to postgres");
    await db.query(
      "grant all privileges on all tables in schema cron to postgres",
    );
    const existing = (
      await db.query(
        "select command from cron.job where jobname='3t-minute-maintenance'",
      )
    ).rows;
    if (
      existing.some((j) => j.command !== "select public.run_scheduled_jobs();")
    )
      throw Object.assign(new Error(), { code: "EXISTING_JOB_CONFLICT" });
    await db.query(
      "select cron.schedule('3t-minute-maintenance','* * * * *','select public.run_scheduled_jobs();')",
    );
    await db.query("commit");
    transaction = false;
  }
  const installed = (
    await db.query("select extname from pg_extension where extname='pg_cron'")
  ).rowCount;
  console.log(
    JSON.stringify({
      installed: !!installed,
      jobs: installed
        ? (
            await db.query(
              "select jobname,schedule,active from cron.job where jobname in ('3t-minute-maintenance','3t-storage-cleanup') order by jobname",
            )
          ).rows
        : [],
      lastRuns: installed
        ? (
            await db.query(
              "select j.jobname,d.status,d.start_time,d.end_time from cron.job_run_details d join cron.job j on j.jobid=d.jobid where j.jobname in ('3t-minute-maintenance','3t-storage-cleanup') order by d.start_time desc limit 6",
            )
          ).rows
        : [],
    }),
  );
} catch (e) {
  if (transaction) await db.query("rollback").catch(() => {});
  console.error(JSON.stringify({ code: e.code || e.name }));
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
