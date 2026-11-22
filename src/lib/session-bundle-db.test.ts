import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite, group: string, am: string, bm: string, category: string;
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  c = "00000000-0000-0000-0000-000000000003";
async function actor(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function session() {
  await actor(a);
  return (
    await db.query<{ id: string }>(
      "select public.create_session($1,$2,'Court',now()-interval '1 hour',now()-interval '1 hour',true,$3,'100000',true) id",
      [group, randomUUID(), [am, bm]],
    )
  ).rows[0].id;
}
async function revision(sid: string) {
  return (
    await db.query<{ r: string }>(
      "select revision::text r from public.sessions where id=$1",
      [sid],
    )
  ).rows[0].r;
}
async function body(sid: string, patch: Record<string, unknown> = {}) {
  return {
    sid,
    expected_revision: await revision(sid),
    expense_id: "",
    category_id: category,
    note_text: "Receipt note",
    title_text: "Water",
    raw_amount: "20000",
    payer: am,
    beneficiaries: [am, bm],
    mode: "total",
    split: "equal",
    values_text: [],
    reason: "Reviewed cost",
    ...patch,
  };
}
async function save(payload: Record<string, unknown>, key = randomUUID()) {
  return (
    await db.query<{ r: { id: string; revision: string; replayed: boolean } }>(
      "select public.execute_financial_command('save_expense',$1,$2) r",
      [key, JSON.stringify(payload)],
    )
  ).rows[0].r;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to public;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`,
  );
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      readFileSync(`supabase/migrations/${file}`, "utf8").replace(
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
      "select public.provision_group($1,'Editor','Sport') id",
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
  am = members.find((x) => x.user_id === a)!.id;
  bm = members.find((x) => x.user_id === b)!.id;
  category = (
    await db.query<{ id: string }>(
      "select id from public.group_expense_categories where group_id=$1 and icon='water'",
      [group],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'A','970415','12345678','A')",
    [a],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});

function payload(patch: Record<string, unknown> = {}) {
const playedTime = new Date(Date.now()-3600000).toISOString();
  return {
    g: group,
    title_text: "Bundle",
    venue_text: "Court",
    start_time: playedTime,
    deadline: playedTime,
    already_played: true,
    people: [am, bm],
    court: "90000",
    be_collector: true,
    weights: { [am]: "2", [bm]: "1" },
    extras: [],
    nominee: "",
    ...patch,
  };
}
async function bundle(body: Record<string, unknown>, key = randomUUID()) {
  await actor(a);
  return (
    await db.query<{ r: { id: string; revision: string; replayed: boolean } }>(
      "select public.execute_financial_command('create_session_bundle',$1,$2) r",
      [key, JSON.stringify(body)],
    )
  ).rows[0].r;
}
it("creates weighted court and multi-payer extras in one recalculation and replays safely", async () => {
  const p = payload({
    extras: [
      {
        expense_id: "",
        category_id: category,
        note_text: "Water note",
        title_text: "Water",
        raw_amount: "10000",
        payer: bm,
        beneficiaries: [am, bm],
        mode: "per_person",
        split: "equal",
        values_text: [],
        reason: "Bundle",
      },
      {
        expense_id: "",
        category_id: "",
        note_text: "",
        title_text: "Discount",
        raw_amount: "-10000",
        payer: am,
        beneficiaries: [am, bm],
        mode: "total",
        split: "weighted",
        values_text: [],
        reason: "Bundle",
      },
    ],
  });
  const key = randomUUID(),
    result = await bundle(p, key);
  expect((await bundle(p, key)).replayed).toBe(true);
  const sid = result.id;
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.session_recalculations where session_id=$1",
        [sid],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.expenses where session_id=$1",
        [sid],
      )
    ).rows[0].n,
  ).toBe(3);
  const sums = (
    await db.query<{ expenses: string; allocations: string }>(
      "select (select sum(amount)::text from public.expenses where session_id=$1) expenses,(select sum(a.share_amount)::text from public.expense_allocations a join public.expenses e on e.id=a.expense_id where e.session_id=$1) allocations",
      [sid],
    )
  ).rows[0];
  expect(sums).toEqual({ expenses: "100000", allocations: "100000" });
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.settlements where session_id=$1 and status='cancelled'",
        [sid],
      )
    ).rows[0].n,
  ).toBe(0);
  await db.exec("reset role");
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from app_private.session_construction_context",
      )
    ).rows[0].n,
  ).toBe(0);
});
it("rolls back the entire creation when a later extra is invalid", async () => {
  await actor(a);
  const before = (
    await db.query<{ n: number }>("select count(*)::int n from public.sessions")
  ).rows[0].n;
  await expect(
    bundle(
      payload({
        extras: [
          {
            expense_id: "",
            category_id: "",
            note_text: "",
            title_text: "Invalid",
            raw_amount: "1000",
            payer: am,
            beneficiaries: [randomUUID()],
            mode: "total",
            split: "equal",
            values_text: [],
            reason: "Bundle",
          },
        ],
      }),
    ),
  ).rejects.toThrow();
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.sessions",
      )
    ).rows[0].n,
  ).toBe(before);
});
it("rejects weights for non-attendees and zero weights", async () => {
  for (const weights of [{ [am]: "0" }, { [randomUUID()]: "1" }])
    await expect(bundle(payload({ weights }))).rejects.toThrow();
});
it("creates a planned nomination without committing anyone or assigning the nominee", async () => {
  const result = await bundle(
    payload({
      start_time: new Date(Date.now() + 86400000).toISOString(),
      deadline: new Date(Date.now() + 3600000).toISOString(),
      already_played: false,
      people: [],
      court: "0",
      be_collector: false,
      weights: {},
      nominee: bm,
    }),
  );
  expect(
    (
      await db.query<{ c: string | null }>(
        "select collector_member_id c from public.sessions where id=$1",
        [result.id],
      )
    ).rows[0].c,
  ).toBe(null);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.session_attendees where session_id=$1 and committed_at is not null",
        [result.id],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.approval_requests where session_id=$1 and status='pending'",
        [result.id],
      )
    ).rows[0].n,
  ).toBe(1);
});

