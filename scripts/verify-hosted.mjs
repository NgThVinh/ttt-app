import pg from "pg";
import { databaseUrlForProject } from "./migration-utils.mjs";
import { readFileSync } from "node:fs";
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
const connectionString = databaseUrlForProject(
  process.env.SUPABASE_DB_URL,
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);
const db = new pg.Client({
  connectionString,
  ssl: {
    ca: readFileSync("supabase/certs/prod-ca-2021.crt", "utf8"),
    rejectUnauthorized: true,
  },
  connectionTimeoutMillis: 15000,
  query_timeout: 30000,
});
let stage = "connect";
let transaction = false;
const passed = [];
function assert(condition, label) {
  if (!condition)
    throw Object.assign(new Error(), { code: "ASSERTION_FAILED", label });
  passed.push(label);
}
async function actor(id) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
  await db.query("set local role authenticated");
}
async function denied(sql, args) {
  await db.query("savepoint denied");
  let rejected = false;
  try {
    await db.query(sql, args);
  } catch {
    rejected = true;
    await db.query("rollback to savepoint denied");
  }
  await db.query("release savepoint denied");
  return rejected;
}
async function counts() {
  const result = {};
  for (const table of [
    "groups",
    "group_members",
    "sessions",
    "expenses",
    "settlements",
    "profiles",
    "audit_log",
    "approval_requests",
    "attendance_events",
  ])
    result[table] = (
      await db.query(`select count(*)::text n from public.${table}`)
    ).rows[0].n;
  return result;
}
try {
  await db.connect();
  const before = await counts();
  const authBefore = (await db.query("select count(*)::text n from auth.users"))
    .rows[0].n;
  const users = (
    await db.query(
      "select id from auth.users where email_confirmed_at is not null order by created_at limit 2",
    )
  ).rows;
  if (users.length < 2)
    throw Object.assign(new Error(), {
      code: "NEED_TWO_VERIFIED_TEST_IDENTITIES",
    });
  const [a, b] = users.map((x) => x.id);
  await db.query("begin");
  transaction = true;
  await db.query("set local lock_timeout='5s'");
  stage = "roles";
  const g = (
    await db.query(
      "select public.provision_group($1,'3T rollback smoke test','Badminton') id",
      [a],
    )
  ).rows[0].id;
  await actor(b);
  assert(
    (await db.query("select id from public.groups where id=$1", [g]))
      .rowCount === 0,
    "outsider blocked by hosted RLS",
  );
  assert(
    await denied("select public.provision_group($1,'Forbidden','Test')", [b]),
    "normal user cannot provision groups",
  );
  await db.query("reset role");
  await db.query(
    "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'Smoke B')",
    [g, b],
  );
  const people = (
    await db.query(
      "select id,user_id from public.group_members where group_id=$1",
      [g],
    )
  ).rows;
  const am = people.find((p) => p.user_id === a).id,
    bm = people.find((p) => p.user_id === b).id;
  await actor(a);
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'Smoke A','970415','12345678','TEST') on conflict(id) do update set bank_bin='970415',bank_account_no='12345678',bank_account_name='TEST'",
    [a],
  );
  stage = "accounting";
  const sid = (
    await db.query(
      "select public.create_session($1,'Rollback test','Test court',now()-interval '1 hour',now()-interval '1 hour',true,$2,'100000',true) id",
      [g, [am, bm]],
    )
  ).rows[0].id;
  const detail = async () =>
    (await db.query("select public.session_details($1) d", [sid])).rows[0].d;
  let s = await detail();
  assert(
    s.expenses[0].allocations.reduce((n, p) => n + BigInt(p.amount), 0n) ===
      100000n,
    "hosted allocation totals conserved",
  );
  await actor(b);
  await db.query(
    "select public.add_expense($1,$2,'Shared water','20000',$3,$4,'total','equal','{}','Smoke proposal')",
    [sid, s.revision, bm, [am, bm]],
  );
  assert(
    (await detail()).expenses.length === 1,
    "proposal has no financial effect",
  );
  const r = (
    await db.query(
      "select id,payload_hash from public.approval_requests where session_id=$1 and type='expense_proposal'",
      [sid],
    )
  ).rows[0];
  assert(
    await denied("select public.decide_session_request($1,true,$2)", [
      r.id,
      r.payload_hash,
    ]),
    "requester cannot self approve",
  );
  await actor(a);
  await db.query("select public.decide_session_request($1,true,$2)", [
    r.id,
    r.payload_hash,
  ]);
  s = await detail();
  assert(s.expenses.length === 2, "collector approval activates proposal");
  const transfer = s.settlements.find((p) => p.status === "pending");
  assert(transfer.amount === "40000", "hosted collector settlement correct");
  await actor(b);
  await db.query("select public.payment_action($1,'mark')", [transfer.id]);
  await actor(a);
  await db.query("select public.payment_action($1,'confirm')", [transfer.id]);
  assert(
    (await detail()).status === "settled",
    "manual receipt settles session",
  );
  await actor(b);
  await db.query("select public.request_session_change($1,'leave',$2)", [
    sid,
    { reason: "Smoke refund" },
  ]);
  const leave = (
    await db.query(
      "select id,payload_hash from public.approval_requests where session_id=$1 and type='leave'",
      [sid],
    )
  ).rows[0];
  await actor(a);
  await db.query("select public.decide_session_request($1,true,$2)", [
    leave.id,
    leave.payload_hash,
  ]);
  s = await detail();
  assert(
    s.settlements.some(
      (p) =>
        p.id === transfer.id &&
        p.status === "confirmed" &&
        p.amount === "40000",
    ),
    "confirmed transfer preserved",
  );
  assert(
    s.settlements.some(
      (p) =>
        p.status === "pending" &&
        p.from_member === am &&
        p.to_member === bm &&
        p.amount === "60000",
    ),
    "hosted removal issues correct refund",
  );
  stage = "rollback";
  await db.query("rollback");
  transaction = false;
  assert(
    JSON.stringify(await counts()) === JSON.stringify(before),
    "all temporary business data rolled back",
  );
  assert(
    (await db.query("select count(*)::text n from auth.users")).rows[0].n ===
      authBefore,
    "existing Auth users preserved",
  );
  const tables = await db.query(
    "select count(*)::integer total,count(*) filter(where rowsecurity)::integer protected from pg_tables where schemaname='public'",
  );
  console.log(
    JSON.stringify({
      passed,
      publicTables: tables.rows[0],
      authUsersPreserved: true,
      testDataPersisted: false,
    }),
  );
} catch (e) {
  if (transaction) await db.query("rollback").catch(() => {});
  console.error(
    JSON.stringify({ stage, errorCode: e.code || e.name, label: e.label }),
  );
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
