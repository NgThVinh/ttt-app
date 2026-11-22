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
    "polls",
    "poll_options",
    "poll_votes",
    "notifications",
    "weekly_series",
    "payment_evidence",
    "expense_receipts",
    "storage_cleanup_jobs",
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
  stage = "receipt permissions";
  const evidence = (
    await db.query("select public.add_payment_evidence($1,'screenshot') id", [
      transfer.id,
    ])
  ).rows[0].id;
  const path = (
    await db.query(
      "select storage_path from public.payment_evidence where id=$1",
      [evidence],
    )
  ).rows[0].storage_path;
  assert(
    await denied(
      "insert into storage.objects(bucket_id,name,metadata) values('3t-payment-evidence','unreserved-smoke.jpg','{}')",
    ),
    "hosted Storage rejects unreserved upload",
  );
  await db.query(
    "insert into storage.objects(bucket_id,name,metadata) values('3t-payment-evidence',$1,$2::jsonb)",
    [path, JSON.stringify({ size: 100, mimetype: "image/jpeg" })],
  );
  await db.query("select public.finalize_receipt('3t-payment-evidence',$1)", [
    evidence,
  ]);
  assert(
    (
      await db.query("select status from public.settlements where id=$1", [
        transfer.id,
      ])
    ).rows[0].status === "pending",
    "evidence never confirms a payment",
  );
  await actor(a);
  assert(
    (
      await db.query(
        "select id from storage.objects where bucket_id='3t-payment-evidence' and name=$1",
        [path],
      )
    ).rowCount === 1,
    "hosted receiver can read proof",
  );
  assert(
    await denied(
      "select public.add_payment_evidence($1,'note',null,'Forbidden')",
      [transfer.id],
    ),
    "hosted receiver cannot impersonate sender",
  );
  assert(
    await denied("select public.cleanup_storage_files()"),
    "hosted user cannot execute service cleanup",
  );
  await db.query("reset role");
  await db.query("set local role anon");
  assert(
    (
      await db.query(
        "select id from storage.objects where bucket_id='3t-payment-evidence' and name=$1",
        [path],
      )
    ).rowCount === 0,
    "hosted anonymous proof read blocked",
  );
  await actor(b);
  stage = "accounting";
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
  stage = "scheduling";
  const poll = (
    await db.query(
      "select public.create_poll($1,'Rollback scheduling','Test court',2,now()+interval '1 day',jsonb_build_array(jsonb_build_object('starts_at',now()+interval '2 days','ends_at',now()+interval '2 days 2 hours'))) id",
      [g],
    )
  ).rows[0].id;
  const option = (
    await db.query("select id from public.poll_options where poll_id=$1", [
      poll,
    ])
  ).rows[0].id;
  await actor(b);
  await db.query("select public.vote_poll($1,'yes')", [option]);
  assert(
    await denied("select public.close_poll($1,$2)", [poll, option]),
    "poll member cannot close creator poll",
  );
  await actor(a);
  assert(
    await denied("select public.close_poll($1,$2)", [poll, option]),
    "poll minimum enforced on hosted database",
  );
  await db.query("select public.vote_poll($1,'yes')", [option]);
  const scheduled = (
    await db.query("select public.close_poll($1,$2) id", [poll, option])
  ).rows[0].id;
  assert(
    (
      await db.query(
        "select committed_at from public.session_attendees where session_id=$1",
        [scheduled],
      )
    ).rows.every((r) => r.committed_at === null),
    "poll votes remain uncommitted intentions",
  );
  await db.query("select public.set_weekly_series($1,2)", [scheduled]);
  assert(
    (
      await db.query(
        "select id from public.sessions where weekly_series_id=(select weekly_series_id from public.sessions where id=$1)",
        [scheduled],
      )
    ).rowCount === 3,
    "hosted weekly instances generated",
  );
  stage = "session calendar";
  const calendarRow = async () =>
    (
      await db.query(
        "select to_jsonb(s) s from public.sessions s where id=$1",
        [scheduled],
      )
    ).rows[0].s;
  const calendarBody = (row) => ({
    title: row.title,
    venue: row.venue,
    note: row.note,
    starts_at: row.starts_at,
    commit_deadline: row.commit_deadline,
    reason: "Rollback calendar test",
  });
  let calendar = await calendarRow();
  await actor(b);
  assert(
    await denied("select public.manage_session($1,$2,'edit',$3)", [
      scheduled,
      calendar.revision,
      { ...calendarBody(calendar), title: "Forbidden" },
    ]),
    "hosted member cannot edit someone else's calendar",
  );
  await db.query("select public.set_rsvp($1,true)", [scheduled]);
  await actor(a);
  calendar = await calendarRow();
  const moved = {
    ...calendarBody(calendar),
    commit_deadline: new Date(
      Date.parse(calendar.starts_at) - 30 * 60 * 1000,
    ).toISOString(),
  };
  await db.query("select public.manage_session($1,$2,'edit',$3)", [
    scheduled,
    calendar.revision,
    moved,
  ]);
  assert(
    (
      await db.query(
        "select committed_at from public.session_attendees where session_id=$1 and member_id=$2",
        [scheduled, bm],
      )
    ).rows[0].committed_at === null,
    "hosted reschedule resets commitments for self reconfirmation",
  );
  assert(
    await denied("select public.manage_session($1,$2,'edit',$3)", [
      scheduled,
      calendar.revision,
      moved,
    ]),
    "hosted stale calendar edit rejected",
  );
  calendar = await calendarRow();
  await db.query("select public.manage_session($1,$2,'cancel',$3)", [
    scheduled,
    calendar.revision,
    { reason: "Rollback cancellation" },
  ]);
  assert(
    (await calendarRow()).status === "cancelled",
    "hosted money-free session can be cancelled",
  );
  calendar = await calendarRow();
  await actor(b);
  assert(
    await denied("select public.set_rsvp($1,true)", [scheduled]),
    "hosted cancelled session cannot accept RSVP",
  );
  await actor(a);
  await db.query("select public.manage_session($1,$2,'reopen',$3)", [
    scheduled,
    calendar.revision,
    calendarBody(calendar),
  ]);
  assert(
    (await calendarRow()).status === "planned",
    "hosted cancelled session reopens with future deadline",
  );
  assert(
    await denied("select public.manage_session($1,$2,'cancel',$3)", [
      sid,
      (await detail()).revision,
      { reason: "Must retain money" },
    ]),
    "hosted calendar cancellation cannot bypass financial history",
  );
  stage = "scheduling";
  assert(
    await denied("select public.run_scheduled_jobs()"),
    "users cannot call scheduled maintenance",
  );
  await db.query("reset role");
  await db.query("select public.run_scheduled_jobs()");
  const notificationCount = (
    await db.query(
      "select count(*)::int n from public.notifications where group_id=$1",
      [g],
    )
  ).rows[0].n;
  await db.query("select public.run_scheduled_jobs()");
  assert(
    (
      await db.query(
        "select count(*)::int n from public.notifications where group_id=$1",
        [g],
      )
    ).rows[0].n === notificationCount,
    "hosted reminder retry deduplicated",
  );
  stage = "receipt expiry";
  assert(
    await denied(
      "update public.settlements set confirmed_at=now()-interval '31 days' where id=$1",
      [transfer.id],
    ),
    "confirmed payment timestamp is immutable",
  );
  const expiredPayment = (
    await db.query(
      "insert into public.settlements(session_id,from_member,to_member,amount,ref_code,status,confirmed_at) values($1,$2,$3,1000,public.next_payment_ref(),'confirmed',now()-interval '31 days') returning id",
      [sid, bm, am],
    )
  ).rows[0].id;
  const expired = (
    await db.query(
      "insert into public.payment_evidence(settlement_id,group_id,uploaded_by,kind,storage_path,status) values($1,$2::uuid,$3,'screenshot',$2::uuid::text||'/'||gen_random_uuid()||'.jpg','ready') returning id,storage_path",
      [expiredPayment, g, b],
    )
  ).rows[0];
  await db.query(
    "insert into storage.objects(bucket_id,name,metadata) values('3t-payment-evidence',$1,$2::jsonb)",
    [
      expired.storage_path,
      JSON.stringify({ size: 100, mimetype: "image/jpeg" }),
    ],
  );
  await actor(b);
  assert(
    (
      await db.query(
        "select id from storage.objects where bucket_id='3t-payment-evidence' and name=$1",
        [expired.storage_path],
      )
    ).rowCount === 0,
    "hosted expired proof inaccessible before cleanup",
  );
  await db.query("reset role");
  await db.query("select public.expire_receipt_files()");
  assert(
    (
      await db.query("select status from public.payment_evidence where id=$1", [
        expired.id,
      ])
    ).rows[0].status === "expired",
    "hosted expired proof retains metadata",
  );
  assert(
    (
      await db.query(
        "select id from public.storage_cleanup_jobs where bucket='3t-payment-evidence' and path=$1",
        [expired.storage_path],
      )
    ).rowCount === 1,
    "hosted expiry queues physical deletion",
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
