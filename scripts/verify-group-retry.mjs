import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { databaseUrlForProject } from "./migration-utils.mjs";

delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
const options = {
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
  query_timeout: 15000,
};
const first = new pg.Client(options),
  second = new pg.Client(options);
let pending;
let pendingError;
let stage = "connect";
function assert(ok, label) {
  if (!ok)
    throw Object.assign(new Error(), { code: "ASSERTION_FAILED", label });
}
async function asUser(db, id) {
  await db.query("begin");
  await db.query("set local statement_timeout='12s'");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
  await db.query("set local role authenticated");
}
async function counts() {
  return (
    await first.query(
      "select (select count(*)::text from public.groups) groups,(select count(*)::text from public.group_members) members,(select count(*)::text from public.audit_log) audit,(select count(*)::text from app_private.group_creation_requests) requests",
    )
  ).rows[0];
}
try {
  await first.connect();
  await second.connect();
  const before = await counts();
  const owner = (
    await first.query(
      "select u.id from auth.users u join app_private.super_admin_allowlist a on a.email=lower(trim(u.email)) and a.active where u.email_confirmed_at is not null order by u.created_at limit 1",
    )
  ).rows[0];
  if (!owner)
    throw Object.assign(new Error(), {
      code: "NEED_VERIFIED_ALLOWLISTED_IDENTITY",
    });
  const pid = (await second.query("select pg_backend_pid() pid")).rows[0].pid;
  const key = randomUUID();
  stage = "hold first uncommitted request";
  await asUser(first, owner.id);
  const original = (
    await first.query(
      "select public.create_group('Rollback concurrency test','Sport',$1) id",
      [key],
    )
  ).rows[0].id;
  await asUser(second, owner.id);
  pending = second
    .query(
      "select public.create_group('Rollback concurrency test','Sport',$1) id",
      [key],
    )
    .catch((error) => {
      pendingError = error;
      return null;
    });
  let waited = false;
  // pg_locks exposes only lock metadata here; no SQL parameters or identities are printed.
  for (let attempt = 0; attempt < 50; attempt++) {
    waited = (
      await first.query(
        "select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) waiting",
        [pid],
      )
    ).rows[0].waiting;
    if (waited || pendingError) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(waited, "concurrent retry waits for first transaction");
  stage = "release rolled-back request";
  await first.query("rollback");
  const resumed = await pending;
  if (pendingError) throw pendingError;
  const id = resumed.rows[0].id;
  assert(id !== original, "rolled-back request does not reserve a result");
  assert(
    (
      await second.query(
        "select public.create_group('Rollback concurrency test','Sport',$1) id",
        [key],
      )
    ).rows[0].id === id,
    "retry reuses the surviving transaction result",
  );
  assert(
    (
      await second.query(
        "select id from public.audit_log where group_id=$1 and action='group_created'",
        [id],
      )
    ).rowCount === 1,
    "one audit event per surviving request",
  );
  await second.query("rollback");
  assert(
    JSON.stringify(await counts()) === JSON.stringify(before),
    "both transactions leave no test business data",
  );
  console.log(
    JSON.stringify({
      concurrentRetryWaited: true,
      rollbackReleasedRequest: true,
      retryReusedResult: true,
      testDataPersisted: false,
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
  await first.query("rollback").catch(() => {});
  if (pending) await pending.catch(() => {});
  await second.query("rollback").catch(() => {});
  await Promise.allSettled([first.end(), second.end()]);
}
