import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
let db: PGlite, g: string, other: string, member: string;
const a = randomUUID(),
  b = randomUUID();
async function actor(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to public;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;",
  );
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      readFileSync("supabase/migrations/" + f, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  for (const id of [a, b])
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, id + "@test.local"],
    );
  g = (
    await db.query<{ id: string }>(
      "select public.provision_group($1,'Activity','Sport') id",
      [a],
    )
  ).rows[0].id;
  other = (
    await db.query<{ id: string }>(
      "select public.provision_group($1,'Other activity','Sport') id",
      [b],
    )
  ).rows[0].id;
  member = (
    await db.query<{ id: string }>(
      "select id from public.group_members where group_id=$1 and user_id=$2",
      [g, a],
    )
  ).rows[0].id;
}, 30000);
beforeEach(async () => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec("begin");
});
afterEach(async () => {
  await db.exec("rollback;reset role");
});
afterAll(async () => {
  await db?.close();
});
async function session(
  status = "played",
  time = "now()-interval '1 day'",
  group = g,
  deleted = false,
) {
  return (
    await db.query<{ id: string }>(
      `insert into public.sessions(group_id,title,venue,starts_at,commit_deadline,status,created_by,deleted_at) values($1,'Activity','Court',${time},${time},$2,$3,case when $4 then now() else null end) returning id`,
      [group, status, group === g ? a : b, deleted],
    )
  ).rows[0].id;
}
async function attend(
  sid: string,
  response = "going",
  committed = true,
  removed = false,
) {
  await db.query(
    "insert into public.session_attendees(session_id,member_id,rsvp,committed_at,removed_at) values($1,$2,$3,case when $4 then now() else null end,case when $5 then now() else null end)",
    [sid, member, response, committed, removed],
  );
}
type Activity = {
  today: string;
  group_count: number;
  days: { day: string; mine: number; group_sessions: number }[];
};
async function activity() {
  return (
    await db.query<{ data: Activity }>(
      "select public.my_participation_activity() data",
    )
  ).rows[0].data;
}

it("counts actual finalized sessions and only the user's committed attendance", async () => {
  await attend(await session());
  await attend(await session("settled"));
  await attend(await session(), "not_going");
  await attend(await session(), "going", false);
  await attend(await session(), "going", true, true);
  await attend(await session("planned"));
  await attend(await session("cancelled"));
  await attend(await session("played", "now()+interval '1 day'"));
  const deleted = await session();
  await attend(deleted);
  await db.query("update public.sessions set deleted_at=now() where id=$1", [
    deleted,
  ]);
  await session("played", "now()-interval '1 day'", other);
  await actor(a);
  const result = await activity();
  expect(result.group_count).toBe(1);
  expect(result.days.reduce((n, d) => n + d.mine, 0)).toBe(2);
  expect(result.days.reduce((n, d) => n + d.group_sessions, 0)).toBe(5);
});

it("uses Vietnamese calendar days and bounds history before API limits", async () => {
  const recentMidnight =
    "(date_trunc('day',now() at time zone 'Asia/Ho_Chi_Minh')-interval '1 day'+interval '30 minutes') at time zone 'Asia/Ho_Chi_Minh'";
  await session("played", recentMidnight);
  await session("played", "now()-interval '1 year'");
  await db.query(
    "insert into public.sessions(group_id,title,venue,starts_at,commit_deadline,status,created_by) select $1,'Bulk','Court',now()-interval '1 day',now()-interval '1 day','played',$2 from generate_series(1,1100)",
    [g, a],
  );
  await actor(a);
  const result = await activity();
  expect(result.days.reduce((n, d) => n + d.group_sessions, 0)).toBe(1101);
  const yesterday = (
    await db.query<{ day: string }>(
      "select ((now() at time zone 'Asia/Ho_Chi_Minh')::date-1)::text as \"day\"",
    )
  ).rows[0].day;
  expect(result.days.find((d) => d.day === yesterday)?.group_sessions).toBe(
    1101,
  );
});

it("isolates other groups and revokes aggregates when a member is removed", async () => {
  await session();
  await actor(b);
  expect((await activity()).days).toEqual([]);
  await db.exec("reset role");
  await db.query(
    "update public.group_members set status='removed' where id=$1",
    [member],
  );
  await actor(a);
  expect(await activity()).toMatchObject({ group_count: 0, days: [] });
  await actor("");
  await expect(activity()).rejects.toThrow();
});

it("summarizes outstanding debt exactly without downloading confirmed history", async () => {
  const sid = await session();
  const peer = (
    await db.query<{ id: string }>(
      "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'Peer') returning id",
      [g, b],
    )
  ).rows[0].id;
  for (const [from, to, amount, status] of [
    [member, peer, "9007199254740993", "pending"],
    [member, peer, "1000", "marked_paid"],
    [peer, member, "7000", "pending"],
    [peer, member, "999999", "cancelled"],
  ])
    await db.query(
      "insert into public.settlements(session_id,from_member,to_member,amount,status,ref_code) values($1,$2,$3,$4,$5,$6)",
      [sid, from, to, amount, status, randomUUID()],
    );
  await db.query(
    "insert into public.settlements(session_id,from_member,to_member,amount,status,ref_code) select $1,$2,$3,100000,'confirmed',gen_random_uuid()::text from generate_series(1,1100)",
    [sid, peer, member],
  );
  await actor(a);
  const result = (
    await db.query<{ data: unknown }>("select public.my_debt_summary() data")
  ).rows[0].data;
  expect(result).toEqual({
    owe: "9007199254741993",
    owed: "7000",
    payCount: 2,
    receiveCount: 1,
  });
  await actor(b);
  expect(
    (await db.query<{ data: unknown }>("select public.my_debt_summary() data"))
      .rows[0].data,
  ).toEqual({
    owe: "7000",
    owed: "9007199254741993",
    payCount: 1,
    receiveCount: 2,
  });
  await db.exec("reset role");
  await db.query(
    "update public.group_members set status='removed' where id=$1",
    [member],
  );
  await actor(a);
  expect(
    (await db.query<{ data: unknown }>("select public.my_debt_summary() data"))
      .rows[0].data,
  ).toEqual({ owe: "0", owed: "0", payCount: 0, receiveCount: 0 });
});

it("denies anonymous debt summary execution", async () => {
  await db.exec("set role anon");
  await expect(db.query("select public.my_debt_summary()")).rejects.toThrow(
    /permission denied/,
  );
});
