import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
let db: PGlite,
  group: string,
  guest: string,
  owner: string,
  newcomer: string,
  other: string,
  unverified: string,
  hash: string;
async function actor(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to public;",
  );
  for (const f of [
    "202611210001_core.sql",
    "202611220001_groups.sql",
    "202611220002_member_claims.sql",
    "202611240041_account_onboarding.sql",
  ])
    await db.exec(
      readFileSync("supabase/migrations/" + f, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await db.exec(
    "grant select on public.expense_allocations,public.expenses,public.settlements to authenticated",
  );
}, 30000);
beforeEach(async () => {
  await db.exec("reset role");
  [owner, newcomer, other, unverified] = Array.from({ length: 4 }, () =>
    randomUUID(),
  );
  for (const u of [owner, newcomer, other, unverified])
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)",
      [u, u + "@test.local", u === unverified ? null : new Date()],
    );
  group = (
    await db.query<{ id: string }>(
      "select public.provision_group($1,'Onboarding','Sport') id",
      [owner],
    )
  ).rows[0].id;
  guest = (
    await db.query<{ id: string }>(
      "insert into public.group_members(group_id,display_name) values($1,'Tên cũ') returning id",
      [group],
    )
  ).rows[0].id;
  hash = randomUUID().replaceAll("-", "").repeat(2);
  await actor(owner);
  await db.query(
    "select public.create_invite($1,$2,now()+interval '1 day',1)",
    [group, hash],
  );
});
afterAll(async () => {
  await db?.close();
});
async function join(id = newcomer, claim: string | null = guest) {
  await actor(id);
  return db.query("select public.accept_invite_with_claim($1,'Tên mới',$2)", [
    hash,
    claim,
  ]);
}
async function request() {
  return (
    await db.query<{ id: string }>(
      "select id from public.approval_requests where group_id=$1 and requested_by=$2 and status='pending'",
      [group, newcomer],
    )
  ).rows[0].id;
}
it("only a verified invitation holder sees the limited roster, without unlocking group reads", async () => {
  await actor(newcomer);
  expect(
    (
      await db.query("select * from public.group_members where group_id=$1", [
        group,
      ])
    ).rows,
  ).toHaveLength(0);
  const d = (
    await db.query<{ d: { guests: { id: string; name: string }[] } }>(
      "select public.invite_details($1) d",
      [hash],
    )
  ).rows[0].d;
  expect(d.guests).toEqual([{ id: guest, name: "Tên cũ" }]);
  await expect(
    db.query("select public.invite_details($1)", ["0".repeat(64)]),
  ).rejects.toThrow(/Link/);
  await actor(unverified);
  await expect(
    db.query("select public.invite_details($1)", [hash]),
  ).rejects.toThrow(/email/);
  await expect(join(unverified)).rejects.toThrow(/email/);
  await db.exec("reset role;set role anon");
  await expect(
    db.query("select public.invite_details($1)", [hash]),
  ).rejects.toThrow(/permission/);
});
it("join and claim are atomic and retries at the last invite use are idempotent", async () => {
  await join();
  await join();
  expect(
    (
      await db.query(
        "select * from public.approval_requests where group_id=$1",
        [group],
      )
    ).rows,
  ).toHaveLength(1);
  await actor(owner);
  expect(
    (
      await db.query<{ uses: number }>(
        "select uses from public.invites where group_id=$1",
        [group],
      )
    ).rows[0].uses,
  ).toBe(1);
  expect(
    (
      await db.query<{ user_id: string | null }>(
        "select user_id from public.group_members where id=$1",
        [guest],
      )
    ).rows[0].user_id,
  ).toBeNull();
  await expect(join(other)).rejects.toThrow(/Link/);
});
it("rejects another group's guest without consuming the invitation or creating membership", async () => {
  await db.exec("reset role");
  const foreign = (
    await db.query<{ id: string }>(
      "select public.provision_group($1,'Other','Sport') id",
      [other],
    )
  ).rows[0].id;
  const wrong = (
    await db.query<{ id: string }>(
      "insert into public.group_members(group_id,display_name) values($1,'Other guest') returning id",
      [foreign],
    )
  ).rows[0].id;
  await expect(join(newcomer, wrong)).rejects.toThrow(/Tên/);
  await actor(owner);
  expect(
    (
      await db.query<{ uses: number }>(
        "select uses from public.invites where group_id=$1",
        [group],
      )
    ).rows[0].uses,
  ).toBe(0);
  expect(
    (
      await db.query(
        "select id from public.group_members where group_id=$1 and user_id=$2",
        [group, newcomer],
      )
    ).rows,
  ).toHaveLength(0);
});
it("only admin sees verified claimant email and can approve; old financial IDs stay unchanged", async () => {
  await db.exec("reset role");
  const om = (
    await db.query<{ id: string }>(
      "select id from public.group_members where group_id=$1 and user_id=$2",
      [group, owner],
    )
  ).rows[0].id;
  const sid = (
    await db.query<{ id: string }>(
      "insert into public.sessions(group_id,title,venue,starts_at,commit_deadline,created_by) values($1,'Old','Court',now(),now(),$2) returning id",
      [group, owner],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.session_attendees(session_id,member_id,rsvp) values($1,$2,'going')",
    [sid, guest],
  );
  const eid = (
    await db.query<{ id: string }>(
      "insert into public.expenses(session_id,title,amount,paid_by) values($1,'Court',100000,$2) returning id",
      [sid, om],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.expense_allocations(expense_id,member_id,share_amount) values($1,$2,50000)",
    [eid, guest],
  );
  const settlement = (
    await db.query<{ id: string }>(
      "insert into public.settlements(session_id,from_member,to_member,amount,ref_code,status,confirmed_at) values($1,$2,$3,50000,$4,'confirmed',now()) returning id",
      [sid, guest, om, randomUUID()],
    )
  ).rows[0].id;
  await join();
  const rid = await request();
  await expect(
    db.query("select public.member_claim_reviews($1)", [group]),
  ).rejects.toThrow(/admin/);
  await expect(
    db.query("select public.decide_member_claim($1,true)", [rid]),
  ).rejects.toThrow(/admin/);
  await expect(
    db.query("update public.group_members set user_id=$1 where id=$2", [
      newcomer,
      guest,
    ]),
  ).rejects.toThrow();
  await actor(owner);
  const review = (
    await db.query<{ d: { email: string; email_verified: boolean }[] }>(
      "select public.member_claim_reviews($1) d",
      [group],
    )
  ).rows[0].d;
  expect(review[0]).toMatchObject({
    email: newcomer + "@test.local",
    email_verified: true,
  });
  await db.query("select public.decide_member_claim($1,true)", [rid]);
  await actor(newcomer);
  expect(
    (
      await db.query<{ id: string }>(
        "select id from public.group_members where group_id=$1 and user_id=$2 and status='active'",
        [group, newcomer],
      )
    ).rows[0].id,
  ).toBe(guest);
  expect(
    (
      await db.query<{ share_amount: number }>(
        "select share_amount from public.expense_allocations where expense_id=$1 and member_id=$2",
        [eid, guest],
      )
    ).rows[0].share_amount,
  ).toBe(50000);
  expect(
    (
      await db.query<{ status: string; from_member: string }>(
        "select status,from_member from public.settlements where id=$1",
        [settlement],
      )
    ).rows[0],
  ).toMatchObject({ status: "confirmed", from_member: guest });
  await actor(owner);
  await expect(
    db.query("select public.decide_member_claim($1,true)", [rid]),
  ).rejects.toThrow(/hết hạn/);
});
it("expiry and changed verification cannot approve a stale claim", async () => {
  await join();
  const rid = await request();
  await db.exec("reset role");
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [
    newcomer,
  ]);
  await actor(owner);
  await expect(
    db.query("select public.decide_member_claim($1,true)", [rid]),
  ).rejects.toThrow(/Email/);
  await db.exec("reset role");
  await db.query(
    "update public.approval_requests set expires_at=now()-interval '1 second' where id=$1",
    [rid],
  );
  await actor(owner);
  await expect(
    db.query("select public.decide_member_claim($1,true)", [rid]),
  ).rejects.toThrow(/hết hạn/);
});
it("new account history prevents an unsafe merge; rejection permits a corrected request", async () => {
  await join();
  const rid = await request();
  await db.exec("reset role");
  const current = (
    await db.query<{ id: string }>(
      "select id from public.group_members where group_id=$1 and user_id=$2",
      [group, newcomer],
    )
  ).rows[0].id;
  const sid = (
    await db.query<{ id: string }>(
      "insert into public.sessions(group_id,title,venue,starts_at,commit_deadline,created_by) values($1,'New','Court',now(),now(),$2) returning id",
      [group, owner],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.session_attendees(session_id,member_id) values($1,$2)",
    [sid, current],
  );
  await actor(owner);
  await expect(
    db.query("select public.decide_member_claim($1,true)", [rid]),
  ).rejects.toThrow(/lịch sử/);
  await db.query("select public.decide_member_claim($1,false)", [rid]);
  await actor(newcomer);
  await db.query("select public.request_member_claim($1)", [guest]);
  expect(await request()).not.toBe(rid);
});
it("removed users, revoked links, and unverified member claims cannot bypass restrictions", async () => {
  await join(newcomer, null);
  await db.exec("reset role");
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [
    newcomer,
  ]);
  await actor(newcomer);
  await expect(
    db.query("select public.request_member_claim($1)", [guest]),
  ).rejects.toThrow(/email/);
  await db.exec("reset role");
  await db.query("update auth.users set email_confirmed_at=now() where id=$1", [
    newcomer,
  ]);
  await db.query(
    "update public.group_members set status='removed' where group_id=$1 and user_id=$2",
    [group, newcomer],
  );
  await expect(join()).rejects.toThrow();
  await actor(owner);
  await db.exec("reset role");
  await db.query(
    "update public.invites set revoked_at=now() where group_id=$1",
    [group],
  );
  await expect(join(other, null)).rejects.toThrow(/Link/);
});
