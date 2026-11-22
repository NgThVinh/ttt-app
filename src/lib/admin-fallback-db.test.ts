import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite,
  group: string,
  am: string,
  bm: string,
  cm: string,
  guest: string,
  guestSession: string;
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  c = "00000000-0000-0000-0000-000000000003";
async function actor(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function state(sid: string) {
  return (
    await db.query<{
      s: {
        revision: number;
        status: string;
        collector_member_id: string | null;
        unlocked_until: string | null;
      };
    }>("select to_jsonb(s) s from public.sessions s where id=$1", [sid])
  ).rows[0].s;
}
async function played() {
  await actor(b);
  return (
    await db.query<{ id: string }>(
      "select public.create_session($1,$2,'Court',now()-interval '1 hour',now()-interval '1 hour',true,$3,'100000',true) id",
      [group, Math.random().toString(), [bm, cm]],
    )
  ).rows[0].id;
}
type Preview = { id: string; hash: string; detail: { revision: string } };
async function preview(
  sid: string,
  command: string,
  body: Record<string, unknown>,
  source: string | null = null,
  reason = "Admin fallback reason",
) {
  return (
    await db.query<{ p: Preview }>(
      "select public.preview_admin_financial($1,$2,$3,$4,$5,$6) p",
      [
        sid,
        (await state(sid)).revision,
        command,
        JSON.stringify(body),
        reason,
        source,
      ],
    )
  ).rows[0].p;
}
async function apply(p: Preview) {
  await db.query("select public.apply_admin_financial($1,$2)", [p.id, p.hash]);
}
async function oldRequest(sid: string, kind = "weight") {
  await actor(c);
  if (kind === "weight")
    await db.query("select public.request_session_change($1,'weight',$2)", [
      sid,
      { weight: "0.5", reason: "Half session" },
    ]);
  else
    await db.query(
      "select public.add_expense($1,$2,'Old water','20000',$3,$4,'total','equal','{}','Old proposal')",
      [sid, (await state(sid)).revision, cm, [bm, cm]],
    );
  const r = (
    await db.query<{
      id: string;
      payload_hash: string;
      payload: { expense_id: string };
    }>(
      "select id,payload_hash,payload from public.approval_requests where session_id=$1 and type=$2 order by created_at desc limit 1",
      [sid, kind],
    )
  ).rows[0];
  await db.exec("reset role");
  await db.query(
    "update public.approval_requests set created_at=now()-interval '73 hours',expires_at=now()-interval '1 hour' where id=$1",
    [r.id],
  );
  return r;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to public;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`,
  );
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      readFileSync(`supabase/migrations/${f}`, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'a@test.local',now()),($2,'b@test.local',now()),($3,'c@test.local',now())",
    [a, b, c],
  );
  group = (
    await db.query<{ id: string }>(
      "select public.provision_group($1,'Fallback','Sport') id",
      [a],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'B'),($1,$3,'C')",
    [group, b, c],
  );
  const people = (
    await db.query<{ id: string; user_id: string }>(
      "select id,user_id from public.group_members where group_id=$1",
      [group],
    )
  ).rows;
  am = people.find((m) => m.user_id === a)!.id;
  bm = people.find((m) => m.user_id === b)!.id;
  cm = people.find((m) => m.user_id === c)!.id;
  guest = (
    await db.query<{ id: string }>(
      "insert into public.group_members(group_id,display_name) values($1,'Guest collector') returning id",
      [group],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'B','970415','12345678','B')",
    [b],
  );
  await actor(a);
  await db.query(
    "select public.set_guest_bank($1,'970415','87654321','GUEST','Verified guest bank')",
    [guest],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
it("admin status and caller-set settings cannot bypass an active collector", async () => {
  const sid = await played();
  await actor(a);
  await db.query("select set_config('ttt.admin_fallback','true',false)");
  await expect(
    preview(sid, "apply_financial_change", {
      action_name: "attendee",
      body: { member_id: cm, operation: "weight", weight: "0.5" },
    }),
  ).rejects.toThrow(/điều kiện/);
  await expect(
    db.query(
      "insert into app_private.admin_execution_context values(txid_current(),$1,$2,'apply_financial_change')",
      [a, sid],
    ),
  ).rejects.toThrow();
  await expect(
    db.query("select public.apply_financial_change($1,$2,'attendee',$3)", [
      sid,
      (await state(sid)).revision,
      {
        member_id: cm,
        operation: "weight",
        weight: "0.5",
        reason: "Cannot bypass",
      },
    ]),
  ).rejects.toThrow(/người tính tiền/);
  await actor(c);
  await expect(
    preview(sid, "finish_session", { court: "100000" }),
  ).rejects.toThrow(/quyền/);
});
it("guest assignment previews roll back and finishing records the guest's advance, not the admin's", async () => {
  await actor(c);
  guestSession = (
    await db.query<{ id: string }>(
      "select public.create_session($1,'Guest fallback','Court',now()+interval '1 hour',now()+interval '1 hour',false,'{}','0',false) id",
      [group],
    )
  ).rows[0].id;
  await actor(a);
  await expect(
    preview(
      guestSession,
      "assign_guest_collector",
      { member_id: guest },
      null,
      "",
    ),
  ).rejects.toThrow(/lý do/);
  const p = await preview(guestSession, "assign_guest_collector", {
    member_id: guest,
  });
  expect((await state(guestSession)).collector_member_id).toBeNull();
  await apply(p);
  expect((await state(guestSession)).collector_member_id).toBe(guest);
  await actor(b);
  await db.query("select public.set_rsvp($1,true)", [guestSession]);
  await actor(c);
  await db.query("select public.set_rsvp($1,true)", [guestSession]);
  await db.exec("reset role");
  await db.query(
    "update public.sessions set starts_at=now()-interval '1 hour',commit_deadline=now()-interval '1 hour' where id=$1",
    [guestSession],
  );
  await actor(a);
  const finish = await preview(guestSession, "finish_session", {
    court: "100000",
  });
  await apply(finish);
  expect(
    (
      await db.query<{ paid_by: string }>(
        "select paid_by from public.expenses where session_id=$1 and kind='court'",
        [guestSession],
      )
    ).rows[0].paid_by,
  ).toBe(guest);
  expect(
    (
      await db.query(
        "select id from public.settlements where session_id=$1 and to_member=$2",
        [guestSession, guest],
      )
    ).rows,
  ).toHaveLength(2);
});
it("guest receipt confirmation requires explicit statement review and replay writes nothing twice", async () => {
  await actor(a);
  const payment = (
    await db.query<{ id: string }>(
      "select id from public.settlements where session_id=$1 and status='pending' order by id limit 1",
      [guestSession],
    )
  ).rows[0].id;
  await expect(
    preview(guestSession, "payment_action", {
      target: payment,
      operation: "confirm",
    }),
  ).rejects.toThrow(/điều kiện/);
  const p = await preview(guestSession, "payment_action", {
    target: payment,
    operation: "confirm",
    statement_checked: true,
  });
  await apply(p);
  const revision = (await state(guestSession)).revision;
  await apply(p);
  expect((await state(guestSession)).revision).toBe(revision);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.settlements where id=$1",
        [payment],
      )
    ).rows[0].status,
  ).toBe("confirmed");
  expect(
    (
      await db.query(
        "select id from public.audit_log where session_id=$1 and action='admin_fallback_applied'",
        [guestSession],
      )
    ).rows,
  ).toHaveLength(3);
});
it("an expired request is never revived: admin reviews and applies a fresh request at the current revision", async () => {
  const sid = await played(),
    old = await oldRequest(sid);
  await actor(b);
  await expect(
    db.query("select public.decide_session_request($1,true,$2)", [
      old.id,
      old.payload_hash,
    ]),
  ).rejects.toThrow(/hết hạn/);
  await actor(a);
  const p = await preview(sid, "apply_request", {}, old.id);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.approval_requests where id=$1",
        [old.id],
      )
    ).rows[0].status,
  ).toBe("pending");
  await apply(p);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.approval_requests where id=$1",
        [old.id],
      )
    ).rows[0].status,
  ).toBe("expired");
  const fresh = (
    await db.query<{ id: string; status: string }>(
      "select id,status from public.approval_requests where session_id=$1 and payload->>'source_request_id'=$2",
      [sid, old.id],
    )
  ).rows;
  expect(fresh).toHaveLength(1);
  expect(fresh[0].id).not.toBe(old.id);
  expect(fresh[0].status).toBe("approved");
  expect(
    (
      await db.query<{ weight: string }>(
        "select weight::text from public.session_attendees where session_id=$1 and member_id=$2",
        [sid, cm],
      )
    ).rows[0].weight,
  ).toBe("0.5");
});

it("admin cannot confirm a registered refund recipient's payment even when the collector is a guest", async () => {
  await actor(a);
  const p = await preview(guestSession, "add_expense", {
    title_text: "Advance by C",
    raw_amount: "200000",
    payer: cm,
    beneficiaries: [bm, cm],
    mode: "total",
    split: "equal",
    values_text: [],
  });
  await apply(p);
  const refund = (
    await db.query<{ id: string }>(
      "select id from public.settlements where session_id=$1 and to_member=$2 and status='pending'",
      [guestSession, cm],
    )
  ).rows[0];
  await expect(
    preview(guestSession, "payment_action", {
      target: refund.id,
      operation: "confirm",
      statement_checked: true,
    }),
  ).rejects.toThrow(/điều kiện/);
});

it("an escalated collector nomination still requires the nominee's separate acceptance", async () => {
  const sid = await played();
  await db.exec("reset role");
  await db.query("update public.sessions set created_by=$2 where id=$1", [
    sid,
    c,
  ]);
  await actor(c);
  await db.query(
    "select public.request_session_change($1,'collector_nomination',$2)",
    [sid, { member_id: am, reason: "Change collector" }],
  );
  const old = (
    await db.query<{ id: string }>(
      "select id from public.approval_requests where session_id=$1 and type='collector_nomination' and status='pending'",
      [sid],
    )
  ).rows[0].id;
  await db.exec("reset role");
  await db.query(
    "update public.approval_requests set created_at=now()-interval '73 hours',expires_at=now()-interval '1 hour' where id=$1",
    [old],
  );
  await actor(a);
  const p = await preview(sid, "apply_request", {}, old);
  await apply(p);
  expect((await state(sid)).collector_member_id).toBe(bm);
  const fresh = (
    await db.query<{
      id: string;
      payload_hash: string;
      payload: { phase: string };
    }>(
      "select id,payload_hash,payload from public.approval_requests where session_id=$1 and type='collector_nomination' and status='pending'",
      [sid],
    )
  ).rows[0];
  expect(fresh.payload.phase).toBe("accept");
  expect(
    (
      await db.query<{ valid: boolean }>(
        "select expires_at>now()+interval '71 hours' valid from public.approval_requests where id=$1",
        [fresh.id],
      )
    ).rows[0].valid,
  ).toBe(true);
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'A','970415','11112222','A') on conflict(id) do nothing",
    [a],
  );
  await db.query("select public.decide_session_request($1,true,$2)", [
    fresh.id,
    fresh.payload_hash,
  ]);
  expect((await state(sid)).collector_member_id).toBe(am);
});

it("expired admin preview drafts cannot execute", async () => {
  await actor(a);
  const p = await preview(guestSession, "apply_financial_change", {
    action_name: "attendee",
    body: { member_id: bm, operation: "weight", weight: "0.75" },
  });
  await db.exec("reset role");
  await db.query(
    "update public.approval_requests set expires_at=now()-interval '1 second' where id=$1",
    [p.id],
  );
  await actor(a);
  await expect(apply(p)).rejects.toThrow(/hết hạn/);
  await db.exec("reset role");
  await db.exec("select public.run_scheduled_jobs()");
  expect(
    (
      await db.query("select id from public.notifications where event_key=$1", [
        `escalate-request:${p.id}`,
      ])
    ).rows,
  ).toHaveLength(0);
});
it("expired expense proposals produce a new authored expense instead of activating the rejected one", async () => {
  const sid = await played(),
    old = await oldRequest(sid, "expense_proposal");
  await actor(a);
  const p = await preview(sid, "apply_request", {}, old.id);
  await apply(p);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.expenses where id=$1",
        [old.payload.expense_id],
      )
    ).rows[0].status,
  ).toBe("rejected");
  const fresh = (
    await db.query<{ id: string; created_by: string }>(
      "select id,created_by from public.expenses where session_id=$1 and kind='extra' and status='active'",
      [sid],
    )
  ).rows[0];
  expect(fresh.id).not.toBe(old.payload.expense_id);
  expect(fresh.created_by).toBe(c);
});
it("withdrawn source requests and stale session revisions invalidate admin drafts", async () => {
  const sid = await played(),
    old = await oldRequest(sid);
  await actor(a);
  const p = await preview(sid, "apply_request", {}, old.id);
  await actor(c);
  await db.query("select public.cancel_session_request($1)", [old.id]);
  await actor(a);
  await expect(apply(p)).rejects.toThrow(/điều kiện/);
  const next = await preview(guestSession, "apply_financial_change", {
    action_name: "attendee",
    body: { member_id: bm, operation: "weight", weight: "0.5" },
  });
  const pay = (
    await db.query<{ id: string }>(
      "select id from public.settlements where session_id=$1 and status='pending'",
      [guestSession],
    )
  ).rows[0].id;
  await db.exec("reset role");
  await db.query("update public.sessions set revision=revision+1 where id=$1", [
    guestSession,
  ]);
  await actor(a);
  await expect(apply(next)).rejects.toThrow(/điều kiện/);
  expect(pay).toBeTruthy();
  await db.exec("reset role");
  expect(
    (await db.query("select * from app_private.admin_execution_context")).rows,
  ).toHaveLength(0);
});
it("unlock is admin-only, time bounded, public and does not grant the admin financial authority", async () => {
  const sid = await played();
  await db.exec("reset role");
  await db.query(
    "update public.settlements set status='confirmed',confirmed_at=now()-interval '31 days' where session_id=$1",
    [sid],
  );
  await db.query(
    "update public.sessions set status='settled',settled_at=now()-interval '31 days' where id=$1",
    [sid],
  );
  await actor(c);
  await expect(
    db.query("select public.unlock_session($1,$2,'Reason')", [
      sid,
      (await state(sid)).revision,
    ]),
  ).rejects.toThrow(/admin/);
  await actor(a);
  await expect(
    db.query("select public.unlock_session($1,$2,'')", [
      sid,
      (await state(sid)).revision,
    ]),
  ).rejects.toThrow(/lý do/);
  await db.query("select public.unlock_session($1,$2,'Correct old record')", [
    sid,
    (await state(sid)).revision,
  ]);
  expect(
    (
      await db.query<{ locked: boolean }>(
        "select public.session_is_locked($1) locked",
        [sid],
      )
    ).rows[0].locked,
  ).toBe(false);
  await expect(
    db.query("select public.apply_financial_change($1,$2,'attendee',$3)", [
      sid,
      (await state(sid)).revision,
      {
        member_id: cm,
        operation: "weight",
        weight: "0.5",
        reason: "No authority",
      },
    ]),
  ).rejects.toThrow(/người tính tiền/);
  await db.exec("reset role");
  await db.query(
    "update public.sessions set unlocked_until=now()-interval '1 second' where id=$1",
    [sid],
  );
  await actor(b);
  await expect(
    db.query(
      "select public.add_expense($1,$2,'Old fix','1000',$3,$4,'total','equal','{}','Fix')",
      [sid, (await state(sid)).revision, bm, [bm, cm]],
    ),
  ).rejects.toThrow(/khóa/);
  await actor(a);
  await db.query("select public.unlock_session($1,$2,'Renew review')", [
    sid,
    (await state(sid)).revision,
  ]);
  await actor(b);
  await db.query(
    "select public.add_expense($1,$2,'Old fix','1000',$3,$4,'total','equal','{}','Fix')",
    [sid, (await state(sid)).revision, bm, [bm, cm]],
  );
  expect(
    (
      await db.query(
        "select id from public.settlements where session_id=$1 and status='confirmed'",
        [sid],
      )
    ).rows,
  ).toHaveLength(1);
});
