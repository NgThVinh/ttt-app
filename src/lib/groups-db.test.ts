import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
const admin = "00000000-0000-0000-0000-000000000001",
  member = "00000000-0000-0000-0000-000000000002",
  outsider = "00000000-0000-0000-0000-000000000003";
let group: string;
async function actor(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to public;`,
  );
  for (const file of [
    "202611210001_core.sql",
    "202611220001_groups.sql",
    "202611220002_member_claims.sql",
  ])
    await db.exec(
      readFileSync(`supabase/migrations/${file}`, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values ($1,'admin@test.local',now()),($2,'member@test.local',now()),($3,'outside@test.local',now())",
    [admin, member, outsider],
  );
  const result = await db.query<{ id: string }>(
    "select public.provision_group($1,'Test group','Badminton') id",
    [admin],
  );
  group = result.rows[0].id;
}, 30000);
afterAll(async () => {
  await db?.close();
});
it("outsider cannot see group or members or create groups", async () => {
  await actor(outsider);
  expect((await db.query("select * from public.groups")).rows).toHaveLength(0);
  expect(
    (await db.query("select * from public.group_members")).rows,
  ).toHaveLength(0);
  await expect(
    db.query("select public.provision_group($1,'Forbidden','Sport')", [
      outsider,
    ]),
  ).rejects.toThrow(/permission denied/i);
});
it("admin can add stubs; member management cannot cross group boundary", async () => {
  await actor(admin);
  await db.query("select public.manage_member($1,null,'add','Guest')", [group]);
  await actor(outsider);
  await expect(
    db.query("select public.manage_member($1,null,'add','Hacker')", [group]),
  ).rejects.toThrow(/admin/);
});
it("invites are single use, joining is idempotent while valid and cannot bypass revocation", async () => {
  await actor(admin);
  const hash = "a".repeat(64);
  const r = await db.query<{ id: string }>(
    "select public.create_invite($1,$2,now()+interval '1 day',2) id",
    [group, hash],
  );
  await actor(member);
  await db.query("select public.accept_invite($1,'Member')", [hash]);
  await db.query("select public.accept_invite($1,'Member')", [hash]);
  await expect(db.query("select * from public.invites")).resolves.toMatchObject(
    { rows: [] },
  );
  await expect(
    db.query("select public.manage_member($1,null,'add','No')", [group]),
  ).rejects.toThrow(/admin/);
  await actor(admin);
  expect(
    (
      await db.query<{ uses: number }>(
        "select uses from public.invites where id=$1",
        [r.rows[0].id],
      )
    ).rows[0].uses,
  ).toBe(1);
  await db.query("select public.revoke_invite($1)", [r.rows[0].id]);
  await actor(outsider);
  await expect(
    db.query("select public.accept_invite($1,'Outside')", [hash]),
  ).rejects.toThrow(/Link/);
});
it("rejects expired and exhausted invites", async () => {
  await db.exec("reset role");
  await db.query(
    "insert into public.invites(group_id,token_hash,expires_at,max_uses,uses,created_by) values($1,$2,now()-interval '1 second',1,0,$3),($1,$4,now()+interval '1 day',1,1,$3)",
    [group, "b".repeat(64), admin, "c".repeat(64)],
  );
  await actor(outsider);
  for (const hash of ["b".repeat(64), "c".repeat(64)])
    await expect(
      db.query("select public.accept_invite($1,'Outside')", [hash]),
    ).rejects.toThrow(/Link/);
});
it("last admin cannot be removed or demoted", async () => {
  await actor(admin);
  const m = await db.query<{ id: string }>(
    "select id from public.group_members where user_id=$1",
    [admin],
  );
  for (const op of ["remove", "member"])
    await expect(
      db.query("select public.manage_member($1,$2,$3)", [
        group,
        m.rows[0].id,
        op,
      ]),
    ).rejects.toThrow(/admin/);
});
it("claims require admin approval and preserve the original member ID", async () => {
  await actor(member);
  const stub = await db.query<{ id: string }>(
    "select id from public.group_members where user_id is null and status='active' limit 1",
  );
  await db.query("select public.request_member_claim($1)", [stub.rows[0].id]);
  const request = await db.query<{ id: string }>(
    "select id from public.approval_requests where type='member_claim' and status='pending'",
  );
  await expect(
    db.query("select public.decide_member_claim($1,true)", [
      request.rows[0].id,
    ]),
  ).rejects.toThrow(/admin/);
  await actor(admin);
  await db.query("select public.decide_member_claim($1,true)", [
    request.rows[0].id,
  ]);
  expect(
    (
      await db.query<{ id: string }>(
        "select id from public.group_members where user_id=$1",
        [member],
      )
    ).rows[0].id,
  ).toBe(stub.rows[0].id);
  await expect(
    db.query("select public.decide_member_claim($1,true)", [
      request.rows[0].id,
    ]),
  ).rejects.toThrow(/hết hạn/);
});
it("removing a member revokes access and cannot be undone using an invite", async () => {
  await actor(admin);
  const m = await db.query<{ id: string }>(
    "select id from public.group_members where user_id=$1",
    [member],
  );
  await db.query("select public.manage_member($1,$2,'remove')", [
    group,
    m.rows[0].id,
  ]);
  await db.query(
    "select public.create_invite($1,$2,now()+interval '1 day',1)",
    [group, "d".repeat(64)],
  );
  await actor(member);
  expect((await db.query("select * from public.groups")).rows).toHaveLength(0);
  await expect(
    db.query("select public.accept_invite($1,'Again')", ["d".repeat(64)]),
  ).rejects.toThrow(/admin/);
});
it("profiles are private and logs remain immutable even for the database owner", async () => {
  await actor(admin);
  await db.query(
    "insert into public.profiles(id,display_name) values($1,'Admin')",
    [admin],
  );
  await actor(outsider);
  expect((await db.query("select * from public.profiles")).rows).toHaveLength(
    0,
  );
  await expect(
    db.query(
      "insert into public.profiles(id,display_name) values($1,'Imposter')",
      [member],
    ),
  ).rejects.toThrow();
  await db.exec("reset role");
  await expect(
    db.exec("update public.audit_log set action='tampered'"),
  ).rejects.toThrow(/bất biến/);
  await expect(db.exec("delete from public.audit_log")).rejects.toThrow(
    /bất biến/,
  );
});
