import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";

let db: PGlite;
let group: string;
let memberB: string, memberC: string, memberD: string;
const a = "00000000-0000-0000-0000-000000000001";
const b = "00000000-0000-0000-0000-000000000002";
const c = "00000000-0000-0000-0000-000000000003";
const d = "00000000-0000-0000-0000-000000000004";
const outsider = "00000000-0000-0000-0000-000000000005";
type CalendarRow = {
  title: string;
  venue: string;
  note: string | null;
  starts_at: string;
  commit_deadline: string;
  revision: number;
  status: string;
  schedule_generation: number;
  collector_member_id: string | null;
};
async function actor(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function session() {
  await actor(b);
  return (
    await db.query<{ id: string }>(
      "select public.create_session($1,'Calendar','Court',now()+interval '90 minutes',now()+interval '1 hour',false,'{}','0',false) id",
      [group],
    )
  ).rows[0].id;
}
async function current(sid: string) {
  return (
    await db.query<{ s: CalendarRow }>(
      "select to_jsonb(s) s from public.sessions s where id=$1",
      [sid],
    )
  ).rows[0].s;
}
function metadata(s: CalendarRow, patch: Record<string, unknown> = {}) {
  return {
    title: s.title,
    venue: s.venue,
    note: s.note,
    starts_at: s.starts_at,
    commit_deadline: s.commit_deadline,
    reason: "Test calendar change",
    ...patch,
  };
}
async function manage(
  sid: string,
  operation: string,
  body: unknown,
  revision?: number | null,
) {
  return db.query("select public.manage_session($1,$2,$3,$4)", [
    sid,
    revision === undefined ? (await current(sid)).revision : revision,
    operation,
    JSON.stringify(body),
  ]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to public;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`,
  );
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(
      readFileSync(`supabase/migrations/${f}`, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  }
  for (const id of [a, b, c, d, outsider])
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1::uuid,$1::uuid::text||'@test.local',now())",
      [id],
    );
  group = (
    await db.query<{ id: string }>(
      "select public.provision_group($1,'Calendar permissions','Sport') id",
      [a],
    )
  ).rows[0].id;
  const members = (
    await db.query<{ id: string; user_id: string }>(
      "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'Creator'),($1,$3,'Collector'),($1,$4,'Participant') returning id,user_id",
      [group, b, c, d],
    )
  ).rows;
  memberB = members.find((m) => m.user_id === b)!.id;
  memberC = members.find((m) => m.user_id === c)!.id;
  memberD = members.find((m) => m.user_id === d)!.id;
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'C','970415','12345678','C')",
    [c],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});

it("all active members manage open schedules; outsiders and removed members cannot", async () => {
  const sid = await session();
  await actor(c);
  await db.query("select public.claim_collector($1,0,'0')", [sid]);
  for (const id of [b, c, a]) {
    await actor(id);
    await manage(
      sid,
      "edit",
      metadata(await current(sid), { title: `Edited by ${id}` }),
    );
  }
  const s = await current(sid);
  await actor(d);
  await manage(sid,"edit",metadata(s,{title:"Edited by another member"}),s.revision);
  await expect(
    db.query("update public.sessions set title='Forbidden' where id=$1", [sid]),
  ).rejects.toThrow();
  await actor(outsider);
  await expect(manage(sid, "edit", metadata(s), s.revision)).rejects.toThrow(
    /quyền/,
  );
  await db.exec("reset role");
  await db.query(
    "update public.group_members set status='removed' where id=$1",
    [memberB],
  );
  await actor(b);
  await expect(manage(sid, "edit", metadata(s), s.revision)).rejects.toThrow(
    /quyền/,
  );
  await db.exec("reset role");
  await db.query(
    "update public.group_members set status='active' where id=$1",
    [memberB],
  );
  await db.exec("set role anon");
  await expect(manage(sid, "edit", metadata(s), s.revision)).rejects.toThrow();
});

it("rejects stale revisions, financial fields, malformed metadata and missing reasons; no-op edits do not notify", async () => {
  const sid = await session();
  const s = await current(sid);
  for (const patch of [
    { amount: "1000" },
    { collector_member_id: memberD },
    { reason: "" },
    { title: " " },
    { note: 123 },
    { commit_deadline: "2099-12-31T00:00:00Z" },
    { starts_at: "infinity" },
  ]) {
    await expect(manage(sid, "edit", metadata(s, patch))).rejects.toThrow();
  }
  await expect(manage(sid, "edit", metadata(s), null)).rejects.toThrow(
    /thay đổi/,
  );
  await manage(sid, "edit", metadata(s));
  expect((await current(sid)).revision).toBe(0);
  expect(
    (
      await db.query(
        "select id from public.notifications where event_key like $1",
        [`session-calendar:${sid}:%`],
      )
    ).rows,
  ).toHaveLength(0);
  await manage(sid, "edit", metadata(s, { title: "New title" }));
  await expect(
    manage(sid, "edit", metadata(s, { title: "Stale" }), 0),
  ).rejects.toThrow(/thay đổi/);
});

it("rescheduling requires fresh self commitments, preserves choice history and re-arms deduplicated reminders", async () => {
  const sid = await session();
  await actor(d);
  await db.query("select public.set_rsvp($1,true)", [sid]);
  await actor(c);
  await db.query("select public.set_rsvp($1,false)", [sid]);
  await db.exec("reset role");
  await db.exec("select public.run_scheduled_jobs()");
  expect(
    (
      await db.query("select id from public.notifications where event_key=$1", [
        `commit:${sid}:2`,
      ])
    ).rows.length,
  ).toBeGreaterThan(0);
  await actor(b);
  const s = await current(sid);
  // A later deadline in the same reminder window tests generation-based dedupe.
  const movedDeadline = new Date(
    Date.parse(s.commit_deadline) + 5 * 60 * 1000,
  ).toISOString();
  await manage(sid, "edit", metadata(s, { commit_deadline: movedDeadline }));
  const choices = (
    await db.query<{ rsvp: string; committed_at: string | null }>(
      "select rsvp,committed_at from public.session_attendees where session_id=$1",
      [sid],
    )
  ).rows;
  expect(choices).toHaveLength(2);
  expect(
    choices.every((x) => x.rsvp === "none" && x.committed_at === null),
  ).toBe(true);
  const events = (
    await db.query<{
      before: { rsvp: string; committed_at: string };
      after: { rsvp: string };
    }>(
      "select before,after from public.attendance_events where session_id=$1 and action='rsvp_reset'",
      [sid],
    )
  ).rows;
  expect(events).toHaveLength(2);
  expect(
    events.every((x) => !!x.before.committed_at && x.after.rsvp === "none"),
  ).toBe(true);
  expect((await current(sid)).schedule_generation).toBe(1);
  await db.exec("reset role");
  await db.exec("select public.run_scheduled_jobs()");
  const reminders = (
    await db.query(
      "select event_key from public.notifications where event_key like $1",
      [`commit:${sid}:1:%`],
    )
  ).rows;
  expect(reminders).toHaveLength(4);
  await db.exec("select public.run_scheduled_jobs()");
  expect(
    (
      await db.query(
        "select event_key from public.notifications where event_key like $1",
        [`commit:${sid}:1:%`],
      )
    ).rows,
  ).toHaveLength(4);
  await actor(d);
  await db.query("select public.set_rsvp($1,true)", [sid]);
  expect(
    (
      await db.query<{ source: string }>(
        "select commit_source source from public.session_attendees where session_id=$1 and member_id=$2",
        [sid, memberD],
      )
    ).rows[0].source,
  ).toBe("self");
});

it("finalized metadata is locked while an overdue reminder does not lock an open schedule",async()=>{
 await actor(c);const sid=(await db.query<{id:string}>("select public.create_session($1,'Locked','Court',now()-interval '1 hour',now()-interval '1 hour',true,$2,'100000',true) id",[group,[memberB,memberC]])).rows[0].id;
 const s=await current(sid);await expect(manage(sid,'edit',metadata(s,{venue:'Changed'}))).rejects.toThrow(/lịch đã khóa/);expect(await current(sid)).toEqual(s);
 const open=await session();await db.exec('reset role');await db.query("update public.sessions set commit_deadline=now()-interval '1 minute' where id=$1",[open]);await actor(d);
 await manage(open,'edit',metadata(await current(open),{starts_at:'2099-01-01T00:00:00Z',commit_deadline:'2099-01-01T00:00:00Z'}));
 expect((await current(open)).status).toBe('planned');
});

it("cancelling retains history, closes pending requests and reopening requires future self commitments", async () => {
  const sid = await session();
  await db.query(
    "select public.request_session_change($1,'collector_nomination',$2)",
    [sid, { member_id: memberC, reason: "Please collect" }],
  );
  await actor(d);
  await db.query("select public.set_rsvp($1,true)", [sid]);
  await actor(b);
  await manage(sid, "cancel", { reason: "Court closed" });
  const s = await current(sid);
  expect(s.status).toBe("cancelled");
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.approval_requests where session_id=$1",
        [sid],
      )
    ).rows[0].status,
  ).toBe("cancelled");
  expect(
    (
      await db.query(
        "select id from public.attendance_events where session_id=$1",
        [sid],
      )
    ).rows.length,
  ).toBeGreaterThan(0);
  await actor(d);
  await expect(
    db.query("select public.set_rsvp($1,true)", [sid]),
  ).rejects.toThrow();
  await actor(c);
  await expect(
    db.query("select public.claim_collector($1,$2,'0')", [sid, s.revision]),
  ).rejects.toThrow();
  await actor(a);
  await expect(
    manage(
      sid,
      "reopen",
      metadata(s, {
        starts_at: "2020-01-01T00:00:00Z",
        commit_deadline: "2020-01-01T00:00:00Z",
      }),
    ),
  ).rejects.toThrow(/tương lai/);
  await manage(sid, "reopen", metadata(s));
  expect((await current(sid)).status).toBe("planned");
  expect((await current(sid)).collector_member_id).toBeNull();
  const attendee = (
    await db.query<{ rsvp: string; committed_at: string | null }>(
      "select rsvp,committed_at from public.session_attendees where session_id=$1",
      [sid],
    )
  ).rows[0];
  expect(attendee).toEqual({ rsvp: "none", committed_at: null });
  await expect(
    manage(sid, "cancel", { reason: "Replay" }, s.revision),
  ).rejects.toThrow(/thay đổi/);
});

it("any nonzero expense history or transfer blocks administrative cancellation", async () => {
  for (const status of ["active", "proposed", "deleted", "rejected"]) {
    const sid = await session();
    await db.exec("reset role");
    await db.query(
      "insert into public.expenses(session_id,title,amount,paid_by,created_by,status) values($1,'History',1000,$2,$3,$4)",
      [sid, memberC, c, status],
    );
    await actor(a);
    await expect(
      manage(sid, "cancel", { reason: "Must not hide money" }),
    ).rejects.toThrow(/số tiền/);
    expect((await current(sid)).status).toBe("planned");
  }
  const sid = await session();
  await db.exec("reset role");
  await db.query(
    "insert into public.settlements(session_id,from_member,to_member,amount,ref_code,status) values($1,$2,$3,1000,public.next_payment_ref(),'cancelled')",
    [sid, memberD, memberC],
  );
  await actor(b);
  await expect(
    manage(sid, "cancel", { reason: "Must not hide transfer" }),
  ).rejects.toThrow(/số tiền/);
});

it("one-instance cancellation leaves weekly siblings intact and settled locks still apply to admins", async () => {
  const sid = await session();
  await db.query("select public.set_weekly_series($1,2)", [sid]);
  const siblings = (
    await db.query<{ id: string }>(
      "select id from public.sessions where weekly_series_id=(select weekly_series_id from public.sessions where id=$1) and id<>$1",
      [sid],
    )
  ).rows;
  expect(siblings).toHaveLength(2);
  await manage(sid, "cancel", { reason: "Cancel only this week" });
  for (const sibling of siblings)
    expect((await current(sibling.id)).status).toBe("planned");
  await db.exec("reset role");
  await db.query(
    "update public.sessions set status='settled',settled_at=now()-interval '31 days' where id=$1",
    [siblings[0].id],
  );
  await actor(a);
  await expect(
    manage(
      siblings[0].id,
      "edit",
      metadata(await current(siblings[0].id), { title: "Locked" }),
    ),
  ).rejects.toThrow(/khóa/);
});
