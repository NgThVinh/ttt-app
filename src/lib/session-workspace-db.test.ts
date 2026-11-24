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

async function setup() {
  await actor(0);
  const { id } = await schedule(payload({ be_collector: true }));
  await db.query("select public.set_rsvp($1,true)", [id]);
  await actor(1);
  await db.query("select public.set_rsvp($1,true)", [id]);
  await actor(0);
  return id;
}
function extra(patch: Record<string, unknown> = {}) {
  return {
    expense_id: "",
    category_id: "",
    note_text: "",
    title_text: "Nước",
    raw_amount: "60000",
    payer: members[1],
    beneficiaries: [members[0], members[1]],
    mode: "total",
    split: "equal",
    values_text: [],
    reason: "Chốt chi phí",
    ...patch,
  };
}
async function finish(
  sid: string,
  extras: Record<string, unknown>[],
  key = randomUUID(),
) {
  const s = await details(sid);
  const body = { sid, expected_revision: s.revision, court: "200000", extras };
  const result = await db.query<{ r: { replayed: boolean } }>(
    "select public.execute_financial_command('finish_session_bundle',$1,$2) r",
    [key, body],
  );
  return { result: result.rows[0].r, body, key };
}
it("finalizes court plus extras once, with one recalculation and retry protection", async () => {
  const sid = await setup();
  const { body, key, result } = await finish(sid, [
    extra(),
    extra({
      title_text: "Giảm giá",
      raw_amount: "-5000",
      mode: "per_person",
      payer: members[0],
    }),
  ]);
  expect(result.replayed).toBe(false);
  expect(
    (await details(sid)).expenses
      .map((e) => BigInt(e.amount))
      .reduce((a, b) => a + b, 0n),
  ).toBe(250000n);
  expect((await details(sid)).booking_locked).toBe(true);
  const sum = await db.query<{ total: number }>(
    "select sum(a.share_amount)::bigint total from public.expense_allocations a join public.expenses e on e.id=a.expense_id where e.session_id=$1",
    [sid],
  );
  expect(BigInt(sum.rows[0].total)).toBe(250000n);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.session_recalculations where session_id=$1",
        [sid],
      )
    ).rows[0].n,
  ).toBe(1);
  const replay = await db.query<{ r: { replayed: boolean } }>(
    "select public.execute_financial_command('finish_session_bundle',$1,$2) r",
    [key, body],
  );
  expect(replay.rows[0].r.replayed).toBe(true);
  expect((await details(sid)).expenses).toHaveLength(3);
  await expect(
    db.query(
      "select public.execute_financial_command('finish_session_bundle',$1,$2)",
      [key, { ...body, court: "300000" }],
    ),
  ).rejects.toThrow(/nội dung/);
  await actor(1);
  await expect(finish(sid, [])).rejects.toThrow();
});
it("rolls back court, extras, booking lock and RSVP changes if any extra is invalid", async () => {
  const sid = await setup();
  const before = await details(sid);
  await expect(
    finish(sid, [extra(), extra({ payer: randomUUID() })]),
  ).rejects.toThrow();
  const after = await details(sid);
  expect(after.status).toBe("planned");
  expect(after.revision).toBe(before.revision);
  expect(after.expenses).toEqual(before.expenses);
  expect(after.attendees.find((a) => a.member_id === members[2])?.rsvp).toBe(
    "none",
  );
  await expect(
    finish(sid, [extra({ beneficiaries: [members[2]] })]),
  ).rejects.toThrow();
});
it("rejects non collectors, stale previews and invalid amounts; supports percent and exact splits", async () => {
  const sid = await setup();
  await actor(1);
  await expect(finish(sid, [])).rejects.toThrow();
  await actor(0);
  const before = await details(sid);
  await db.query("select public.set_rsvp($1,false)", [sid]);
  await expect(
    db.query(
      "select public.execute_financial_command('finish_session_bundle',$1,$2)",
      [
        randomUUID(),
        { sid, expected_revision: before.revision, court: "1", extras: [] },
      ],
    ),
  ).rejects.toThrow();
  await db.query("select public.set_rsvp($1,true)", [sid]);
  await expect(
    finish(sid, [extra({ raw_amount: "1000000000001" })]),
  ).rejects.toThrow();
  const done = await finish(sid, [
    extra({ split: "percent", values_text: ["25", "75"] }),
    extra({ split: "exact", values_text: ["10000", "50000"] }),
  ]);
  expect(done.result.replayed).toBe(false);
});
it("pages history with stable cursors even at equal timestamps, with membership and page limits", async () => {
  const sid = await setup();
  await db.exec("reset role");
  await db.query(
    "insert into public.audit_log(group_id,session_id,actor_id,action,created_at) select $1,$2,$3,'test-history',now() from generate_series(1,55)",
    [group, sid, users[0]],
  );
  const count = (
    await db.query<{ n: number }>(
      "select ((select count(*) from public.audit_log where session_id=$1 and action<>\'allocation_snapshot\')+(select count(*) from public.attendance_events where session_id=$1))::int n",
      [sid],
    )
  ).rows[0].n;
  await actor(0);
  const detail = (
    await db.query<{ d: { history: unknown[] } }>(
      "select public.session_details($1) d",
      [sid],
    )
  ).rows[0].d;
  expect(detail.history).toEqual([]);
  const ids: string[] = [];
  let cursor: { created_at: string; id: string } | null = null;
  for (let page = 0; page < 10; page++) {
    const r: {
      items: { created_at: string; id: string }[];
      has_more: boolean;
    } = (
      await db.query<{
        r: { items: { created_at: string; id: string }[]; has_more: boolean };
      }>("select public.session_history_page($1,$2,$3,20) r", [
        sid,
        cursor?.created_at || null,
        cursor?.id || null,
      ])
    ).rows[0].r;
    const items: { created_at: string; id: string }[] = r.items.slice(0, 20);
    ids.push(...items.map((i) => i.id));
    cursor = items.at(-1) || null;
    if (!r.has_more) break;
  }
  expect(ids).toHaveLength(count);
  expect(new Set(ids).size).toBe(count);
  await expect(
    db.query("select public.session_history_page($1,null,null,100)", [sid]),
  ).rejects.toThrow(/Trang/);
  await actor(3);
  await expect(
    db.query("select public.session_history_page($1)", [sid]),
  ).rejects.toThrow(/quyền/);
});
