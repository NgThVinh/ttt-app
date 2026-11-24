import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
let db: PGlite, group: string;
const users = [1, 2, 3, 4].map(
  (n) => `00000000-0000-4000-8000-00000000000${n}`,
);
let members: string[];
async function actor(index: number) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    users[index],
  ]);
  await db.exec("set role authenticated");
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to public;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;",
  );
  for (const file of readdirSync("supabase/migrations")
    .filter((v) => v.endsWith(".sql"))
    .sort())
    await db.exec(
      readFileSync(`supabase/migrations/${file}`, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  for (const user of users)
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1::uuid,$1::uuid::text||'@test.local',now())",
      [user],
    );
  group = (
    await db.query<{ id: string }>(
      "select public.provision_group($1,'Equal members','Sport') id",
      [users[0]],
    )
  ).rows[0].id;
  for (const user of users.slice(1, 3))
    await db.query(
      "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'Member')",
      [group, user],
    );
  members = (
    await db.query<{ id: string }>(
      "select id from public.group_members where group_id=$1 order by user_id",
      [group],
    )
  ).rows.map((r) => r.id);
  for (const user of users.slice(0, 3))
    await db.query(
      "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'Test','970436','12345678','TEST')",
      [user],
    );
}, 30000);
afterAll(async () => {
  await db?.close();
});
function payload(patch: Record<string, unknown> = {}) {
  const starts = new Date(Date.now() + 86400000).toISOString();
  return {
    g: group,
    title_text: "Meeting",
    venue_text: "Court",
    start_time: starts,
    ends_at: new Date(Date.parse(starts) + 7200000).toISOString(),
    deadline: starts,
    note: "Bring water",
    be_collector: false,
    nominee: "",
    invitees: [members[1], members[2]],
    ...patch,
  };
}
async function schedule(body = payload(), key = randomUUID()) {
  return (
    await db.query<{ r: { id: string; replayed: boolean } }>(
      "select public.schedule_meeting($1,$2) r",
      [key, body],
    )
  ).rows[0].r;
}
async function details(sid: string) {
  return (
    await db.query<{
      d: {
        revision: string;
        status: string;
        booking_locked: boolean;
        collector_member_id: string | null;
        attendees: {
          member_id: string;
          rsvp: string;
          committed_at: string | null;
        }[];
        expenses: { id: string; amount: string }[];
        settlements: { id: string; amount: string }[];
      };
    }>("select public.session_details($1) d", [sid])
  ).rows[0].d;
}
it.each([1, 2])(
  "ordinary member %s creates a meeting and group invitation without admin",
  async (index) => {
    await actor(index);
    const s = await schedule();
    expect(
      (await details(s.id)).attendees.every(
        (a) => a.rsvp === "none" && a.committed_at === null,
      ),
    ).toBe(true);
    const invited = await db.query(
      "select public.create_invite($1,repeat('a',64),now()+interval '1 day',2)",
      [group],
    );
    expect(invited.rows).toHaveLength(1);
    // Distinct tokens are required by the invitation table.
    await db.exec("reset role");
    await db.query(
      "update public.invites set token_hash=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','') where token_hash=repeat('a',64)",
    );
  },
);
it("meeting retries preserve one set of invitations and reject a changed payload", async () => {
  await actor(1);
  const body = payload(),
    key = randomUUID(),
    s = await schedule(body, key);
  expect((await schedule(body, key)).replayed).toBe(true);
  expect((await details(s.id)).attendees).toHaveLength(2);
  await expect(schedule({ ...body, note: "changed" }, key)).rejects.toThrow(
    /nội dung khác/,
  );
  await db.exec("reset role");
  expect(
    (
      await db.query(
        "select id from public.notifications where event_key like $1",
        ["session-invite:" + s.id + ":%"],
      )
    ).rows,
  ).toHaveLength(2);
});
it("bad end time and a foreign invitee roll back the whole meeting", async () => {
  await actor(1);
  const count = async () =>
    (
      await db.query("select id from public.sessions where group_id=$1", [
        group,
      ])
    ).rows.length;
  const before = await count();
  const body = payload();
  await expect(schedule({ ...body, ends_at: body.start_time })).rejects.toThrow(
    /kết thúc/,
  );
  await expect(schedule({ ...body, invitees: [randomUUID()] })).rejects.toThrow(
    /thuộc nhóm/,
  );
  expect(await count()).toBe(before);
});
it("inviting twice preserves an accepted RSVP and only the invitee can accept or withdraw", async () => {
  await actor(1);
  const { id } = await schedule();
  await actor(2);
  await db.query("select public.set_rsvp($1,true)", [id]);
  await actor(1);
  await db.query("select public.invite_session_members($1,$2)", [
    id,
    [members[2]],
  ]);
  expect(
    (await details(id)).attendees.find((a) => a.member_id === members[2])?.rsvp,
  ).toBe("going");
  await actor(2);
  await db.query("select public.set_rsvp($1,false)", [id]);
  expect(
    (await details(id)).attendees.find((a) => a.member_id === members[2])?.rsvp,
  ).toBe("not_going");
  expect(
    (await details(id)).attendees.find((a) => a.member_id === members[1])?.rsvp,
  ).toBe("none");
});
it("the reminder deadline never locks RSVP before costs are finalized", async () => {
  await actor(1);
  const { id } = await schedule();
  await db.exec("reset role");
  await db.query(
    "update public.sessions set commit_deadline=now()-interval '1 hour' where id=$1",
    [id],
  );
  await db.query("select public.run_scheduled_jobs()");
  expect(
    (
      await db.query(
        "select member_id from public.session_attendees where session_id=$1 and committed_at is not null",
        [id],
      )
    ).rows,
  ).toHaveLength(0);
  await actor(2);
  await db.query("select public.set_rsvp($1,true)", [id]);
  await db.query("select public.set_rsvp($1,false)", [id]);
  expect((await details(id)).booking_locked).toBe(false);
});
it("any member can nominate; only that nominee may accept and a claim itself creates no bill", async () => {
  await actor(1);
  const { id } = await schedule();
  await actor(2);
  await db.query(
    "select public.request_session_change($1,'collector_nomination',$2)",
    [id, { member_id: members[1], reason: "A is collector" }],
  );
  const r = (
    await db.query<{ id: string; payload_hash: string }>(
      "select id,payload_hash from public.approval_requests where session_id=$1",
      [id],
    )
  ).rows[0];
  await actor(0);
  await expect(
    db.query("select public.decide_session_request($1,true,$2)", [
      r.id,
      r.payload_hash,
    ]),
  ).rejects.toThrow(/tự xác nhận/);
  expect((await details(id)).collector_member_id).toBeNull();
  await actor(1);
  await db.query("select public.decide_session_request($1,true,$2)", [
    r.id,
    r.payload_hash,
  ]);
  expect((await details(id)).collector_member_id).toBe(members[1]);
  expect((await details(id)).expenses).toHaveLength(0);
  await actor(2);
  await expect(
    db.query("select public.claim_collector($1,$2,'0')", [
      id,
      (await details(id)).revision,
    ]),
  ).rejects.toThrow();
});
it("collector finalization locks the schedule and attendance atomically while billing only accepted people", async () => {
  await actor(1);
  const { id } = await schedule();
  await db.query("select public.set_rsvp($1,true)", [id]);
  await db.query("select public.claim_collector($1,$2,'0')", [
    id,
    (await details(id)).revision,
  ]);
  await actor(0);
  await db.query("select public.set_rsvp($1,true)", [id]);
  await expect(
    db.query("select public.finish_session($1,$2,'100000')", [
      id,
      (await details(id)).revision,
    ]),
  ).rejects.toThrow();
  await actor(1);
  const revision = (await details(id)).revision;
  // Even before the scheduled time, only the collector can deliberately finalize.
  await db.query("select public.finish_session($1,$2,'100000')", [
    id,
    revision,
  ]);
  const s = await details(id);
  expect(s.booking_locked).toBe(true);
  expect(s.settlements[0].amount).toBe("50000");
  expect(s.attendees.find((a) => a.member_id === members[2])?.rsvp).toBe(
    "not_going",
  );
  await actor(2);
  await expect(
    db.query("select public.set_rsvp($1,true)", [id]),
  ).rejects.toThrow(/chốt chi phí/);
  await actor(0);
  await expect(
    db.query("select public.set_rsvp($1,false)", [id]),
  ).rejects.toThrow(/chốt chi phí/);
  await expect(
    db.query("select public.invite_session_members($1,$2)", [id, [members[0]]]),
  ).rejects.toThrow(/chốt chi phí/);
  await expect(
    db.query("select public.manage_session($1,$2,'edit',$3)", [
      id,
      s.revision,
      {
        title: "Changed",
        venue: "Court",
        starts_at: payload().start_time,
        commit_deadline: payload().start_time,
        reason: "Try",
      },
    ]),
  ).rejects.toThrow(/lịch đã khóa/);
  await expect(
    db.query("select public.reserve_expense_receipt($1)", [s.expenses[0].id]),
  ).rejects.toThrow(/người tính tiền/);
  await actor(1);
  await db.query("select public.reserve_expense_receipt($1)", [
    s.expenses[0].id,
  ]);
});
it("outsiders and removed members cannot schedule, invite, RSVP or read the group", async () => {
  await actor(1);
  const { id } = await schedule();
  for (const index of [3, 2]) {
    if (index === 2) {
      await db.exec("reset role");
      await db.query(
        "update public.group_members set status='removed' where id=$1",
        [members[2]],
      );
    }
    await actor(index);
    await expect(schedule()).rejects.toThrow(/quyền/);
    await expect(
      db.query("select public.invite_session_members($1,$2)", [
        id,
        [members[1]],
      ]),
    ).rejects.toThrow(/quyền/);
    await expect(
      db.query("select public.set_rsvp($1,true)", [id]),
    ).rejects.toThrow(/quyền/);
    await expect(details(id)).rejects.toThrow(/quyền/);
  }
});
