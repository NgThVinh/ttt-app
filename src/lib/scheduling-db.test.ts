import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
let db: PGlite;
let group: string;
let reminderSid: string;
let memberA: string, memberB: string;
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  outsider = "00000000-0000-0000-0000-000000000003";
async function actor(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
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
    "insert into auth.users(id,email,email_confirmed_at) values($1,'a@test.local',now()),($2,'b@test.local',now()),($3,'out@test.local',now())",
    [a, b, outsider],
  );
  group = (
    await db.query<{ id: string }>(
      "select public.provision_group($1,'Scheduling','Badminton') id",
      [a],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'B')",
    [group, b],
  );
  const members = (
    await db.query<{ id: string; user_id: string }>(
      "select id,user_id from public.group_members where group_id=$1",
      [group],
    )
  ).rows;
  memberA = members.find((m) => m.user_id === a)!.id;
  memberB = members.find((m) => m.user_id === b)!.id;
  await actor(a);
  reminderSid = (
    await db.query<{ r: { id: string } }>(
      "select public.schedule_calendar_meeting($1,$2::jsonb) r",
      [randomUUID(), JSON.stringify(calendarBody("Reminders"))],
    )
  ).rows[0].r.id;
}, 30000);
afterAll(async () => {
  await db?.close();
});

const calendarBody = (title: string, repeat = 0) => {
  const start = Date.now() + 2 * 86400000;
  return {
    g: group,
    title_text: title,
    venue_text: "Court",
    start_time: new Date(start).toISOString(),
    ends_at: new Date(start + 7200000).toISOString(),
    deadline: new Date(start).toISOString(),
    note: "Bring water",
    be_collector: false,
    nominee: "",
    invitees: [memberA, memberB],
    repeat_weeks: repeat,
  };
};

it("a member creates a weekly series with times/invitations atomically and retries cannot duplicate or change it", async () => {
  await actor(b);
  const key = randomUUID(),
    body = calendarBody("Calendar repeat", 2);
  const create = () =>
    db.query<{ result: { id: string; replayed: boolean } }>(
      "select public.schedule_calendar_meeting($1,$2::jsonb) result",
      [key, JSON.stringify(body)],
    );
  const first = (await create()).rows[0].result;
  expect(first.replayed).toBe(false);
  const series = (
    await db.query<{ weekly_series_id: string }>(
      "select weekly_series_id from public.sessions where id=$1",
      [first.id],
    )
  ).rows[0].weekly_series_id;
  const instances = (
    await db.query<{
      id: string;
      seconds: number;
      collector_member_id: string | null;
      note: string;
    }>(
      "select id,extract(epoch from ends_at-starts_at)::int seconds,collector_member_id,note from public.sessions where weekly_series_id=$1",
      [series],
    )
  ).rows;
  expect(instances).toHaveLength(3);
  expect(
    instances.every(
      (s) =>
        s.seconds === 7200 &&
        s.collector_member_id === null &&
        s.note === "Bring water",
    ),
  ).toBe(true);
  const attendees = (
    await db.query<{ rsvp: string; committed_at: unknown }>(
      "select rsvp,committed_at from public.session_attendees where session_id=any($1::uuid[])",
      [instances.map((s) => s.id)],
    )
  ).rows;
  expect(attendees).toHaveLength(6);
  expect(
    attendees.every((a) => a.rsvp === "none" && a.committed_at === null),
  ).toBe(true);
  expect((await create()).rows[0].result).toMatchObject({
    id: first.id,
    replayed: true,
  });
  await expect(
    db.query("select public.schedule_calendar_meeting($1,$2::jsonb)", [
      key,
      JSON.stringify({ ...body, repeat_weeks: 3 }),
    ]),
  ).rejects.toThrow(/nội dung khác/);
  expect(
    (
      await db.query(
        "select id from public.sessions where weekly_series_id=$1",
        [series],
      )
    ).rows,
  ).toHaveLength(3);
  await actor(outsider);
  await expect(create()).rejects.toThrow(/quyền/);
});

it("repeat validation cannot leave a session or receipt behind", async () => {
  await actor(b);
  const key = randomUUID(),
    body = calendarBody("Invalid repeat", 13);
  await expect(
    db.query("select public.schedule_calendar_meeting($1,$2::jsonb)", [
      key,
      JSON.stringify(body),
    ]),
  ).rejects.toThrow(/tuần lặp/);
  expect(
    (
      await db.query(
        "select id from public.sessions where title='Invalid repeat'",
      )
    ).rows,
  ).toHaveLength(0);
  await db.exec("reset role");
  expect(
    (
      await db.query(
        "select request_key from app_private.financial_command_results where request_key=$1",
        [key],
      )
    ).rows,
  ).toHaveLength(0);
});

it("a failure starting recurrence rolls back the session, invitations and all receipts", async () => {
  await actor(b);
  const key = randomUUID(),
    body = calendarBody("Repeat rollback", 2);
  await db.exec("reset role");
  const before = (
    await db.query<{ n: number }>(
      "select count(*)::int n from app_private.financial_command_results",
    )
  ).rows[0].n;
  await db.exec(
    "create function app_private.reject_test_repeat() returns trigger language plpgsql as $$begin if new.title='Repeat rollback' then raise exception 'TEST_REPEAT_FAILED';end if;return new;end$$;create trigger reject_test_repeat before insert on public.weekly_series for each row execute function app_private.reject_test_repeat();",
  );
  try {
    await actor(b);
    await expect(
      db.query("select public.schedule_calendar_meeting($1,$2::jsonb)", [
        key,
        JSON.stringify(body),
      ]),
    ).rejects.toThrow(/TEST_REPEAT_FAILED/);
    expect(
      (
        await db.query(
          "select id from public.sessions where title='Repeat rollback'",
        )
      ).rows,
    ).toHaveLength(0);
    await db.exec("reset role");
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from app_private.financial_command_results",
        )
      ).rows[0].n,
    ).toBe(before);
  } finally {
    await db.exec(
      "reset role;drop trigger reject_test_repeat on public.weekly_series;drop function app_private.reject_test_repeat();",
    );
  }
});

it("scheduled debt reminders never confirm payments and retries do not spam", async () => {
  await db.exec("reset role");
  const sid = (
    await db.query<{ id: string }>(
      "insert into public.sessions(group_id,title,venue,starts_at,commit_deadline,status,collector_member_id,created_by) values($1,'Debt reminder','Court',now()-interval '10 days',now()-interval '10 days','played',$2,$3) returning id",
      [group, memberA, a],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.settlements(session_id,from_member,to_member,amount,ref_code,status,created_at,marked_paid_at) values($1,$2,$3,10000,'REM234','pending',now()-interval '7 days',null),($1,$2,$3,20000,'REM235','marked_paid',now()-interval '5 days',now()-interval '3 days')",
    [sid, memberB, memberA],
  );
  await db.exec("select public.run_scheduled_jobs()");
  const before = (
    await db.query<{ n: number }>(
      "select count(*)::int n from public.notifications",
    )
  ).rows[0].n;
  expect(
    (
      await db.query(
        "select id from public.notifications where event_key like 'debt:%'",
      )
    ).rows.length,
  ).toBeGreaterThan(0);
  await db.exec("select public.run_scheduled_jobs()");
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.notifications",
      )
    ).rows[0].n,
  ).toBe(before);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.settlements where session_id=$1",
        [sid],
      )
    ).rows
      .map((r) => r.status)
      .sort(),
  ).toEqual(["marked_paid", "pending"]);
});
it("notification read operations cannot affect another user", async () => {
  await actor(a);
  const id = (
    await db.query<{ id: string }>(
      "select id from public.notifications limit 1",
    )
  ).rows[0].id;
  await actor(b);
  await db.query("select public.mark_notification_read($1)", [id]);
  await actor(a);
  expect(
    (
      await db.query<{ read_at: null }>(
        "select read_at from public.notifications where id=$1",
        [id],
      )
    ).rows[0].read_at,
  ).toBeNull();
  await db.query("select public.mark_notification_read($1)", [id]);
  expect(
    (
      await db.query<{ read_at: string }>(
        "select read_at from public.notifications where id=$1",
        [id],
      )
    ).rows[0].read_at,
  ).not.toBeNull();
});
it("weekly generation is idempotent and normal users cannot run maintenance", async () => {
  await actor(a);
  const sid = (
    await db.query<{ id: string }>(
      "select public.create_session($1,'Weekly','Court',now()+interval '1 hour',now()+interval '1 hour',false,'{}','0',false) id",
      [group],
    )
  ).rows[0].id;
  await db.query("select public.set_weekly_series($1,3)", [sid]);
  expect(
    (
      await db.query(
        "select id from public.sessions where weekly_series_id=(select weekly_series_id from public.sessions where id=$1)",
        [sid],
      )
    ).rows,
  ).toHaveLength(4);
  await expect(db.exec("select public.run_scheduled_jobs()")).rejects.toThrow(
    /permission denied/,
  );
  await db.exec("reset role");
  await db.exec("select public.generate_weekly_sessions()");
  expect(
    (
      await db.query(
        "select id from public.sessions where weekly_series_id=(select weekly_series_id from public.sessions where id=$1)",
        [sid],
      )
    ).rows,
  ).toHaveLength(4);
});
it("scheduled reminders preserve uncommitted invitations and are deduplicated", async () => {
  await db.exec("reset role");
  const sid = (
    await db.query<{ id: string }>("select $1::uuid id", [reminderSid])
  ).rows[0].id;
  await db.query(
    "update public.sessions set starts_at=now()-interval '1 minute',commit_deadline=now()-interval '1 minute' where id=$1",
    [sid],
  );
  const beforeRsvp = (
    await db.query(
      "select member_id,rsvp,committed_at,commit_source from public.session_attendees where session_id=$1 order by member_id",
      [sid],
    )
  ).rows;
  await db.exec("select public.run_scheduled_jobs()");
  expect(
    (
      await db.query(
        "select member_id,rsvp,committed_at,commit_source from public.session_attendees where session_id=$1 order by member_id",
        [sid],
      )
    ).rows,
  ).toEqual(beforeRsvp);
  const count = (
    await db.query<{ n: number }>(
      "select count(*)::int n from public.notifications",
    )
  ).rows[0].n;
  await db.exec("select public.run_scheduled_jobs()");
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.notifications",
      )
    ).rows[0].n,
  ).toBe(count);
});
