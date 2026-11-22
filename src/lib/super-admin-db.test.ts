import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  c = "00000000-0000-0000-0000-000000000003";
const key = "10000000-0000-0000-0000-000000000001";
const otherOwner = "00000000-0000-0000-0000-000000000004";
let group: string;
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
    "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'Owner@Test.local',now(),'{}'),($2,'member@test.local',now(),'{\"role\":\"super_admin\",\"email\":\"Owner@Test.local\"}'),($3,'unverified@test.local',null,'{}')",
    [a, b, c],
  );
  await db.exec(
    "insert into app_private.super_admin_allowlist(email) values('owner@test.local'),('unverified@test.local')",
  );
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'other-owner@test.local',now())",
    [otherOwner],
  );
  await db.exec(
    "insert into app_private.super_admin_allowlist(email) values('other-owner@test.local')",
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
it("uses verified canonical Auth email, ignoring editable metadata", async () => {
  await actor(b);
  expect(
    (await db.query<{ ok: boolean }>("select public.is_super_admin() ok"))
      .rows[0].ok,
  ).toBe(false);
  await expect(
    db.query("select public.create_group('Forbidden','Sport',$1)", [key]),
  ).rejects.toThrow(/super admin/);
  await actor(c);
  expect(
    (await db.query<{ ok: boolean }>("select public.is_super_admin() ok"))
      .rows[0].ok,
  ).toBe(false);
  await expect(
    db.query("select public.create_group('Forbidden','Sport',$1)", [key]),
  ).rejects.toThrow(/xác minh/);
  await actor(a);
  expect(
    (await db.query<{ ok: boolean }>("select public.is_super_admin() ok"))
      .rows[0].ok,
  ).toBe(true);
});
it("creates exactly one group/admin/audit per request and rejects altered retries", async () => {
  await actor(a);
  group = (
    await db.query<{ id: string }>(
      "select public.create_group(' Club ','Sport',$1) id",
      [key],
    )
  ).rows[0].id;
  expect(
    (
      await db.query<{ id: string }>(
        "select public.create_group('Club','Sport',$1) id",
        [key],
      )
    ).rows[0].id,
  ).toBe(group);
  expect((await db.query("select id from public.groups")).rows).toHaveLength(1);
  expect(
    (
      await db.query(
        "select id from public.group_members where group_id=$1 and user_id=$2 and role='admin'",
        [group, a],
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query(
        "select id from public.audit_log where group_id=$1 and action='group_created'",
        [group],
      )
    ).rows,
  ).toHaveLength(1);
  await expect(
    db.query("select public.create_group('Different','Sport',$1)", [key]),
  ).rejects.toThrow(/nội dung khác/);
  await expect(
    db.query("select public.create_group(' ','Sport',$1)", [key]),
  ).rejects.toThrow(/không hợp lệ/);
});
it("request keys are scoped to the actor and super admin status does not bypass group isolation", async () => {
  await actor(otherOwner);
  const ownGroup = (
    await db.query<{ id: string }>(
      "select public.create_group('Club','Sport',$1) id",
      [key],
    )
  ).rows[0].id;
  expect(ownGroup).not.toBe(group);
  expect(
    (await db.query("select id from public.groups where id=$1", [group])).rows,
  ).toHaveLength(0);
  await actor(a);
  expect(
    (await db.query("select id from public.groups where id=$1", [ownGroup]))
      .rows,
  ).toHaveLength(0);
});
it("private state and owner-only helper cannot be read, forged or executed by client roles", async () => {
  for (const role of ["authenticated", "anon", "service_role"]) {
    await db.exec("reset role");
    await db.exec(`set role ${role}`);
    await expect(
      db.query("select * from app_private.super_admin_allowlist"),
    ).rejects.toThrow();
    await expect(
      db.query("update app_private.super_admin_allowlist set active=true"),
    ).rejects.toThrow();
    await expect(
      db.query("select * from app_private.group_creation_requests"),
    ).rejects.toThrow();
    await expect(
      db.query("select public.provision_group($1,'Bypass','Sport')", [a]),
    ).rejects.toThrow();
    if (role !== "authenticated")
      await expect(
        db.query("select public.create_group('Bypass','Sport',$1)", [key]),
      ).rejects.toThrow();
  }
});
it("revocation also blocks retries and an Auth email change invalidates prior authority", async () => {
  await db.exec("reset role");
  await db.exec(
    "update app_private.super_admin_allowlist set active=false where email='owner@test.local'",
  );
  await actor(a);
  await expect(
    db.query("select public.create_group('Club','Sport',$1)", [key]),
  ).rejects.toThrow(/super admin/);
  await db.exec("reset role");
  await db.exec(
    "update app_private.super_admin_allowlist set active=true where email='owner@test.local'",
  );
  await db.query(
    "update auth.users set email='changed@test.local' where id=$1",
    [a],
  );
  await actor(a);
  expect(
    (await db.query<{ ok: boolean }>("select public.is_super_admin() ok"))
      .rows[0].ok,
  ).toBe(false);
  await expect(
    db.query("select public.create_group('Club','Sport',$1)", [key]),
  ).rejects.toThrow(/super admin/);
});
