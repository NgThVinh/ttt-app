import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite, group: string, guest: string, sid: string;
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  c = "00000000-0000-0000-0000-000000000003";
async function actor(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function bank() {
  return (
    await db.query<{
      d: {
        settlements: { bank_account_no: string | null; to_member: string }[];
      };
    }>("select public.session_details($1) d", [sid])
  ).rows[0].d.settlements.find((p) => p.to_member === guest)!.bank_account_no;
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
      "select public.provision_group($1,'Guest bank','Sport') id",
      [a],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'B')",
    [group, b],
  );
  guest = (
    await db.query<{ id: string }>(
      "insert into public.group_members(group_id,display_name) values($1,'Guest') returning id",
      [group],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'A','970415','11112222','A')",
    [a],
  );
  const am = (
    await db.query<{ id: string }>(
      "select id from public.group_members where group_id=$1 and user_id=$2",
      [group, a],
    )
  ).rows[0].id;
  await actor(a);
  sid = (
    await db.query<{ id: string }>(
      "select public.create_session($1,'Guest recipient','Court',now()-interval '1 hour',now()-interval '1 hour',true,$2,'100000',true) id",
      [group, [am, guest]],
    )
  ).rows[0].id;
  await db.exec("reset role");
  await db.query(
    "update public.sessions set collector_member_id=$2 where id=$1",
    [sid, guest],
  );
  await db.query("update public.expenses set paid_by=$2 where session_id=$1", [
    sid,
    guest,
  ]);
  await db.query(
    "select public.recalculate_session($1,'Fixture guest collector')",
    [sid],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
it("only a group admin may save a guest's bank and a public reason is mandatory", async () => {
  await actor(b);
  await expect(
    db.query(
      "select public.set_guest_bank($1,'970415','12345678','GUEST','Test')",
      [guest],
    ),
  ).rejects.toThrow(/admin/);
  await actor(a);
  await expect(
    db.query(
      "select public.set_guest_bank($1,'970415','12345678','GUEST','')",
      [guest],
    ),
  ).rejects.toThrow(/lý do/);
  await db.query(
    "select public.set_guest_bank($1,'970415','12345678','GUEST','Verified with guest')",
    [guest],
  );
  expect(await bank()).toBe("12345678");
  const audit = (
    await db.query<{ payload: { reason: string } }>(
      "select payload from public.audit_log where session_id=$1 and action='guest_bank_updated'",
      [sid],
    )
  ).rows;
  expect(audit).toHaveLength(1);
  expect(audit[0].payload.reason).toBe("Verified with guest");
  expect(JSON.stringify(audit)).not.toContain("12345678");
});
it("bank reads remain group scoped and clients cannot directly change bank rows", async () => {
  await actor(b);
  expect(
    (
      await db.query(
        "select member_id from public.guest_bank_accounts where member_id=$1",
        [guest],
      )
    ).rows,
  ).toHaveLength(1);
  await expect(
    db.query(
      "update public.guest_bank_accounts set bank_account_no='99999999' where member_id=$1",
      [guest],
    ),
  ).rejects.toThrow();
  await actor(c);
  expect(
    (await db.query("select * from public.guest_bank_accounts")).rows,
  ).toHaveLength(0);
  await expect(
    db.query(
      "select public.set_guest_bank($1,'970415','99999999','C','IDOR')",
      [guest],
    ),
  ).rejects.toThrow(/admin/);
});
it("claiming a guest stops guest-bank fallback and lets the linked user manage their own profile", async () => {
  await actor(b);
  await db.query("select public.request_member_claim($1)", [guest]);
  const request = (
    await db.query<{ id: string }>(
      "select id from public.approval_requests where group_id=$1 and type='member_claim' and status='pending'",
      [group],
    )
  ).rows[0].id;
  await actor(a);
  await db.query("select public.decide_member_claim($1,true)", [request]);
  expect(await bank()).toBeNull();
  expect(
    (
      await db.query(
        "select * from public.guest_bank_accounts where member_id=$1",
        [guest],
      )
    ).rows,
  ).toHaveLength(0);
  await expect(
    db.query(
      "select public.set_guest_bank($1,'970415','99999999','CHANGED','Admin cannot override')",
      [guest],
    ),
  ).rejects.toThrow(/tự quản lý/);
  await actor(b);
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'B','970415','87654321','B')",
    [b],
  );
  expect(await bank()).toBe("87654321");
});
