import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
  query_timeout: 30000,
});
const bucket = "3t-payment-evidence";
const path = `smoke/${randomUUID()}.png`;
let storage;
let uploaded = false;
let job;
let stage = "connect";
function assert(ok, label) {
  if (!ok)
    throw Object.assign(new Error(), { code: "ASSERTION_FAILED", label });
}
try {
  if (!process.env.SUPABASE_SECRET_KEY)
    throw Object.assign(new Error(), { code: "SUPABASE_SECRET_KEY_MISSING" });
  await db.connect();
  storage = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  stage = "private buckets";
  for (const name of [bucket, "3t-expense-receipts"]) {
    const { data, error } = await storage.storage.getBucket(name);
    assert(
      !error && data && !data.public && data.file_size_limit === 2097152,
      "private image bucket with 2 MiB limit",
    );
  }
  stage = "upload own fixture";
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const put = await storage.storage
    .from(bucket)
    .upload(path, png, { contentType: "image/png", upsert: false });
  assert(!put.error, "service can upload own fixture");
  uploaded = true;
  assert(
    !(await storage.storage.from(bucket).download(path)).error,
    "fixture exists before cleanup",
  );
  assert(
    !!(await anon.storage.from(bucket).download(path)).error,
    "anonymous download denied",
  );
  assert(
    !!(await anon.storage.from(bucket).createSignedUrl(path, 60)).error,
    "anonymous signing denied",
  );
  stage = "cleanup worker";
  job = (
    await db.query(
      "insert into public.storage_cleanup_jobs(bucket,path) values($1,$2) returning id",
      [bucket, path],
    )
  ).rows[0].id;
  await db.query("select public.cleanup_storage_files()");
  const state = (
    await db.query(
      "select status from public.storage_cleanup_jobs where id=$1",
      [job],
    )
  ).rows[0];
  assert(state.status === "finished", "worker completed Storage API deletion");
  assert(
    !!(await storage.storage.from(bucket).download(path)).error,
    "fixture physically removed",
  );
  uploaded = false;
  console.log(
    JSON.stringify({
      privateBuckets: true,
      anonymousAccessDenied: true,
      storageApiDeletion: true,
      fixtureRemoved: true,
      jobs: (
        await db.query(
          "select jobname,schedule,active from cron.job where jobname in ('3t-storage-cleanup','3t-minute-maintenance') order by jobname",
        )
      ).rows,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      stage,
      code: error.code || error.name,
      label: error.label,
    }),
  );
  process.exitCode = 1;
} finally {
  // Only the generated fixture and its infrastructure job may be removed here.
  if (uploaded && storage) {
    const result = await storage.storage.from(bucket).remove([path]);
    if (result.error) {
      console.error(JSON.stringify({ code: "FIXTURE_CLEANUP_FAILED" }));
      process.exitCode = 1;
    } else uploaded = false;
  }
  if (job && !uploaded)
    await db
      .query(
        "delete from public.storage_cleanup_jobs where id=$1 and bucket=$2 and path=$3",
        [job, bucket, path],
      )
      .catch(() => {
        process.exitCode = 1;
      });
  await db.end().catch(() => {});
}
