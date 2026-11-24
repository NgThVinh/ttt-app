import pg from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const execute = promisify(execFile);
const container = `3t-concurrency-${randomUUID()}`;
const label = "app.3t.disposable-test";
const passed = [];
const clients = [];
let owner,
  options,
  started = false,
  stage = "container";
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  c = "00000000-0000-0000-0000-000000000003",
  d = "00000000-0000-0000-0000-000000000004",
  e = "00000000-0000-0000-0000-000000000005";
let group, am, bm;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function docker(args) {
  return (
    await execute("docker", args, {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120000,
    })
  ).stdout.trim();
}
function assert(ok, label) {
  if (!ok)
    throw Object.assign(new Error(), { code: "ASSERTION_FAILED", label });
}
async function connection() {
  const db = new pg.Client({ ...options, query_timeout: 15000 });
  await db.connect();
  clients.push(db);
  return db;
}
async function as(db, id) {
  await db.query("begin");
  await db.query("set local statement_timeout='12s'");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
  await db.query("set local role authenticated");
}
const command = (db, name, body, key = randomUUID()) =>
  db.query("select public.execute_financial_command($1,$2,$3) result", [
    name,
    key,
    body,
  ]);
async function user(id, fn) {
  const db = await connection();
  try {
    await as(db, id);
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.end();
  }
}
async function race(
  firstActor,
  secondActor,
  firstFn,
  secondFn,
  rollbackFirst = false,
) {
  const first = await connection(),
    second = await connection();
  let pending;
  try {
    await as(first, firstActor);
    await as(second, secondActor);
    const firstResult = await firstFn(first);
    const pid = (await second.query("select pg_backend_pid() pid")).rows[0].pid;
    pending = secondFn(second).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    );
    let waiting = false;
    for (let n = 0; n < 100; n++) {
      waiting = (
        await owner.query(
          "select exists(select 1 from pg_locks where pid=$1 and not granted) waiting",
          [pid],
        )
      ).rows[0].waiting;
      if (waiting) break;
      await delay(20);
    }
    assert(
      waiting,
      "second transaction overlaps and waits on a real database lock",
    );
    await first.query(rollbackFirst ? "rollback" : "commit");
    const outcome = await pending;
    await second.query(outcome.ok ? "commit" : "rollback");
    return { first: firstResult, second: outcome };
  } finally {
    await first.query("rollback").catch(() => {});
    if (pending) await pending;
    await second.query("rollback").catch(() => {});
    await Promise.allSettled([first.end(), second.end()]);
  }
}
async function planned() {
  return (
    await user(a, (db) =>
      db.query(
        "select public.create_session($1,'Race planned','Court',now()+interval '1 day',now()+interval '1 day',false,'{}','0',false) id",
        [group],
      ),
    )
  ).rows[0].id;
}
async function played() {
  return (
    await user(a, (db) =>
      db.query(
        "select public.create_session($1,$2,'Court',now()-interval '1 hour',now()-interval '1 hour',true,$3,'100000',true) id",
        [group, randomUUID(), [am, bm]],
      ),
    )
  ).rows[0].id;
}
async function revision(sid) {
  return (
    await owner.query(
      "select revision::text r from public.sessions where id=$1",
      [sid],
    )
  ).rows[0].r;
}
async function extra(sid) {
  return {
    sid,
    expected_revision: await revision(sid),
    title_text: "Race water",
    raw_amount: "20000",
    payer: am,
    beneficiaries: [am, bm],
    mode: "total",
    split: "equal",
    values_text: [],
    reason: "Concurrent test",
  };
}
async function proposal(sid) {
  await user(b, (db) =>
    db.query(
      "select public.request_session_change($1,'collector_nomination',$2)",
      [sid, { member_id: am, reason: "Race nomination" }],
    ),
  );
  return (
    await owner.query(
      "select id,payload_hash from public.approval_requests where session_id=$1",
      [sid],
    )
  ).rows[0];
}
try {
  await docker([
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "--label",
    `${label}=true`,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "--env",
    "POSTGRES_DB=ttt_concurrency",
    "postgres:17.12-alpine3.24",
  ]);
  started = true;
  const mapping = await docker(["port", container, "5432/tcp"]);
  const port = Number(mapping.match(/127\.0\.0\.1:(\d+)/)?.[1]);
  assert(port > 0, "test PostgreSQL is bound only to loopback");
  options = {
    host: "127.0.0.1",
    port,
    database: "ttt_concurrency",
    user: "postgres",
    connectionTimeoutMillis: 1000,
  };
  for (let n = 0; n < 100; n++) {
    try {
      owner = await connection();
      break;
    } catch {
      await delay(100);
    }
  }
  assert(owner, "test PostgreSQL becomes ready");
  stage = "migrations";
  await owner.query(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to public;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`,
  );
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await owner.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await owner.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'a@test.local',now()),($2,'b@test.local',now()),($3,'c@test.local',now()),($4,'d@test.local',now()),($5,'e@test.local',now())",
    [a, b, c, d, e],
  );
  group = (
    await owner.query(
      "select public.provision_group($1,'Isolated race tests','Sport') id",
      [a],
    )
  ).rows[0].id;
  await owner.query(
    "insert into public.group_members(group_id,user_id,display_name,role) values($1,$2,'B','admin'),($1,$3,'C','member')",
    [group, b, c],
  );
  const members = (
    await owner.query(
      "select id,user_id from public.group_members where group_id=$1",
      [group],
    )
  ).rows;
  am = members.find((m) => m.user_id === a).id;
  bm = members.find((m) => m.user_id === b).id;
  await owner.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'A','970415','12345678','A'),($2,'B','970415','87654321','B')",
    [a, b],
  );

  stage = "collector claim";
  {
    const sid = await planned();
    const body = { sid, expected_revision: "0", court: "100000" };
    const r = await race(
      a,
      b,
      (db) => command(db, "claim_collector", body),
      (db) => command(db, "claim_collector", body),
    );
    assert(!r.second.ok, "only one collector claim succeeds");
    assert(
      (
        await owner.query(
          "select collector_member_id from public.sessions where id=$1",
          [sid],
        )
      ).rows[0].collector_member_id === am,
      "winning collector is preserved",
    );
    assert(
      (
        await owner.query(
          "select id from public.expenses where session_id=$1",
          [sid],
        )
      ).rowCount === 0,
      "claim race creates no bill before finalization",
    );
    passed.push(stage);
  }
  stage = "last invitation use";
  {
    const hash = "a".repeat(64);
    const invite = (
      await user(a, (db) =>
        db.query(
          "select public.create_invite($1,$2,now()+interval '1 day',1) id",
          [group, hash],
        ),
      )
    ).rows[0].id;
    const r = await race(
      d,
      e,
      (db) => db.query("select public.accept_invite($1,'D') id", [hash]),
      (db) => db.query("select public.accept_invite($1,'E') id", [hash]),
    );
    assert(!r.second.ok, "last invitation slot cannot be oversubscribed");
    assert(
      (
        await owner.query("select uses from public.invites where id=$1", [
          invite,
        ])
      ).rows[0].uses === 1,
      "one invitation use consumed",
    );
    await user(d, (db) =>
      db.query("select public.accept_invite($1,'D retry')", [hash]),
    );
    assert(
      (
        await owner.query("select uses from public.invites where id=$1", [
          invite,
        ])
      ).rows[0].uses === 1,
      "successful last-slot retry consumes no extra use",
    );
    passed.push(stage);
  }
  stage = "manual poll scheduling";
  {
    const poll = (
      await user(a, (db) =>
        db.query(
          "select public.create_poll($1,'Race poll','Court',1,now()+interval '1 day',jsonb_build_array(jsonb_build_object('starts_at',now()+interval '2 days','ends_at',now()+interval '2 days 1 hour'),jsonb_build_object('starts_at',now()+interval '3 days','ends_at',now()+interval '3 days 1 hour'))) id",
          [group],
        ),
      )
    ).rows[0].id;
    const slots = (
      await owner.query(
        "select id,starts_at,ends_at from public.poll_options where poll_id=$1 order by starts_at",
        [poll],
      )
    ).rows;
    for (const slot of slots)
      await user(a, (db) =>
        db.query("select public.vote_poll($1,'yes')", [slot.id]),
      );
    const pollBody = (slot) => ({
      g: group,
      title_text: "Manual race",
      venue_text: "Court",
      start_time: slot.starts_at,
      ends_at: slot.ends_at,
      deadline: slot.starts_at,
      note: "",
      be_collector: false,
      nominee: "",
      invitees: [],
    });
    const r = await race(
      a,
      b,
      (db) =>
        db.query("select public.schedule_poll_meeting($1,$2,$3,$4)->>'id' id", [
          randomUUID(),
          poll,
          slots[0].id,
          pollBody(slots[0]),
        ]),
      (db) =>
        db.query("select public.schedule_poll_meeting($1,$2,$3,$4)->>'id' id", [
          randomUUID(),
          poll,
          slots[1].id,
          pollBody(slots[1]),
        ]),
    );
    assert(
      !r.second.ok,
      "competing manual poll forms cannot create a second session",
    );
    assert(
      (
        await owner.query(
          "select collector_member_id from public.sessions where id=$1",
          [r.first.rows[0].id],
        )
      ).rows[0].collector_member_id === null,
      "manual poll form does not assign collector",
    );
    assert(
      (
        await owner.query(
          "select committed_at from public.session_attendees where session_id=$1",
          [r.first.rows[0].id],
        )
      ).rows.every((x) => x.committed_at === null),
      "manual poll form does not commit attendance",
    );
    passed.push(stage);
  }
  for (const sameKey of [true, false]) {
    stage = sameKey
      ? "duplicate approval same key"
      : "duplicate approval different keys";
    const sid = await planned(),
      r = await proposal(sid),
      key = randomUUID(),
      body = { request_id: r.id, approve: true, expected_hash: r.payload_hash };
    const result = await race(
      a,
      a,
      (db) => command(db, "decide_session_request", body, key),
      (db) =>
        command(
          db,
          "decide_session_request",
          body,
          sameKey ? key : randomUUID(),
        ),
    );
    assert(
      sameKey
        ? result.second.ok && result.second.value.rows[0].result.replayed
        : !result.second.ok,
      "approval executes once under both retry forms",
    );
    assert(
      (
        await owner.query(
          "select id from public.session_recalculations where session_id=$1",
          [sid],
        )
      ).rowCount === 0,
      "accepting a collector does not create a financial batch",
    );
    passed.push(stage);
  }
  for (const rollback of [false, true]) {
    stage = rollback
      ? "financial retry after rollback"
      : "financial retry after commit";
    const sid = await played(),
      body = await extra(sid),
      key = randomUUID();
    const r = await race(
      a,
      a,
      (db) => command(db, "add_expense", body, key),
      (db) => command(db, "add_expense", body, key),
      rollback,
    );
    assert(
      r.second.ok && r.second.value.rows[0].result.replayed === !rollback,
      "financial retry reuses commit or recovers rollback",
    );
    assert(
      (
        await owner.query(
          "select id from public.expenses where session_id=$1",
          [sid],
        )
      ).rowCount === 2,
      "retry creates one expense",
    );
    assert(
      (
        await owner.query(
          "select id from public.session_recalculations where session_id=$1",
          [sid],
        )
      ).rowCount === 2,
      "retry creates one batch",
    );
    passed.push(stage);
  }
  for (const confirmFirst of [true, false]) {
    stage = confirmFirst
      ? "confirm before recalculation"
      : "recalculation before confirm";
    const sid = await played(),
      body = await extra(sid),
      payment = (
        await owner.query(
          "select id,amount::text from public.settlements where session_id=$1 and status='pending'",
          [sid],
        )
      ).rows[0];
    const confirm = (db) =>
      command(db, "payment_action", {
        target: payment.id,
        operation: "confirm",
      });
    const recalc = (db) => command(db, "add_expense", body);
    const r = await race(
      a,
      a,
      confirmFirst ? confirm : recalc,
      confirmFirst ? recalc : confirm,
    );
    assert(
      !r.second.ok,
      "stale action cannot cross a concurrently changed financial baseline",
    );
    const old = (
      await owner.query(
        "select status,amount::text from public.settlements where id=$1",
        [payment.id],
      )
    ).rows[0];
    assert(
      old.amount === payment.amount &&
        old.status === (confirmFirst ? "confirmed" : "cancelled"),
      "original payment amount and correct status preserved",
    );
    if (confirmFirst) {
      await user(a, (db) =>
        command(db, "add_expense", {
          ...body,
          expected_revision: String(Number(body.expected_revision) + 1),
        }),
      );
      const pending = (
        await owner.query(
          "select amount::text,status from public.settlements where session_id=$1 and status='pending'",
          [sid],
        )
      ).rows;
      assert(
        pending.length === 1 && pending[0].amount === "10000",
        "post-confirmation recalculation issues exact top-up",
      );
    } else
      assert(
        (
          await owner.query(
            "select amount::text,status from public.settlements where session_id=$1 and status='pending'",
            [sid],
          )
        ).rows[0].amount === "60000",
        "new amount needs a fresh confirmation",
      );
    passed.push(stage);
  }
  for (const finishFirst of [true, false]) {
    stage = finishFirst
      ? "finalize before withdrawal"
      : "withdrawal before finalize";
    const sid = await planned();
    await user(a, (db) =>
      command(db, "claim_collector", {
        sid,
        expected_revision: "0",
        court: "0",
      }),
    );
    for (const id of [a, b])
      await user(id, (db) =>
        db.query("select public.set_rsvp($1,true)", [sid]),
      );
    const before = await revision(sid);
    const finish = (db) =>
      command(db, "finish_session", {
        sid,
        expected_revision: before,
        court: "100000",
      });
    const withdraw = (db) =>
      db.query("select public.set_rsvp($1,false)", [sid]);
    const r = await race(
      finishFirst ? a : b,
      finishFirst ? b : a,
      finishFirst ? finish : withdraw,
      finishFirst ? withdraw : finish,
    );
    assert(
      !r.second.ok,
      "only the action against the current booking state succeeds",
    );
    const state = (
      await owner.query("select status from public.sessions where id=$1", [sid])
    ).rows[0];
    assert(
      state.status === (finishFirst ? "played" : "planned"),
      "no silent finalization across a withdrawal",
    );
    passed.push(stage);
  }
  stage = "duplicate session invitations";
  {
    const sid = await planned();
    const r = await race(
      a,
      b,
      (db) =>
        db.query("select public.invite_session_members($1,$2)", [
          sid,
          [am, bm],
        ]),
      (db) =>
        db.query("select public.invite_session_members($1,$2)", [
          sid,
          [am, bm],
        ]),
    );
    assert(r.second.ok, "both member invitation requests succeed safely");
    assert(
      (
        await owner.query(
          "select member_id from public.session_attendees where session_id=$1 and committed_at is null",
          [sid],
        )
      ).rowCount === 2,
      "invitations never duplicate or commit people",
    );
    passed.push(stage);
  }
  console.log(
    JSON.stringify({
      passed,
      isolatedDatabase: true,
      hostedDatabaseTouched: false,
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
  for (const db of clients) await db.end().catch(() => {});
  if (started) {
    const owned = await docker([
      "inspect",
      "--format",
      `{{index .Config.Labels "${label}"}}`,
      container,
    ]).catch(() => "");
    if (owned === "true")
      await docker(["rm", "--force", container]).catch(() => {
        process.exitCode = 1;
      });
    else {
      console.error(
        JSON.stringify({ code: "TEST_CONTAINER_OWNERSHIP_MISMATCH" }),
      );
      process.exitCode = 1;
    }
  }
}
