import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite, g: string, other: string, aMember: string, bMember: string;
const a = randomUUID(),
  b = randomUUID(),
  c = randomUUID();
async function actor(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function create() {
  await actor(a);
  const starts = new Date(Date.now() + 86400000).toISOString();
  return (
    await db.query<{ r: { id: string } }>(
      "select public.schedule_calendar_meeting($1,$2::jsonb) r",
      [
        randomUUID(),
        JSON.stringify({
          g,
          title_text: "Delete me",
          venue_text: "Court",
          start_time: starts,
          ends_at: new Date(Date.parse(starts) + 7200000).toISOString(),
          deadline: starts,
          note: "",
          be_collector: false,
          nominee: "",
          invitees: [aMember, bMember],
          repeat_weeks: 0,
        }),
      ],
    )
  ).rows[0].r.id;
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
  for (const id of [a, b, c])
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, id + "@test.local"],
    );
  g = (
    await db.query<{ id: string }>(
      "select public.provision_group($1,'Audit group','Sport') id",
      [a],
    )
  ).rows[0].id;
  other = (
    await db.query<{ id: string }>(
      "select public.provision_group($1,'Other group','Sport') id",
      [c],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'Member B')",
    [g, b],
  );
  aMember = (
    await db.query<{ id: string }>(
      "select id from public.group_members where group_id=$1 and user_id=$2",
      [g, a],
    )
  ).rows[0].id;
  bMember = (
    await db.query<{ id: string }>(
      "select id from public.group_members where group_id=$1 and user_id=$2",
      [g, b],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'A','970436','00001234987654321','PRIVATE HOLDER')",
    [a],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
it("any active member can delete an unfinalized session, safely retry and cannot reopen or access it", async () => {
  const sid = await create();
  await actor(b);
  await db.query("select public.delete_unfinalized_session($1,0)", [sid]);
  await db.query("select public.delete_unfinalized_session($1,0)", [sid]);
  expect(
    (await db.query("select id from public.sessions where id=$1", [sid])).rows,
  ).toHaveLength(0);
  await expect(
    db.query("select public.session_details($1)", [sid]),
  ).rejects.toThrow(/xóa/);
  await expect(
    db.query("select public.set_rsvp($1,true)", [sid]),
  ).rejects.toThrow();
  await db.exec("reset role");
  const row = (
    await db.query<{ deleted_at: unknown; revision: string }>(
      "select deleted_at,revision::text from public.sessions where id=$1",
      [sid],
    )
  ).rows[0];
  expect(row.deleted_at).not.toBeNull();
  await expect(
    db.query("update public.sessions set status='planned' where id=$1", [sid]),
  ).rejects.toThrow(/xóa/);
  await actor(a);
  const logs = (
    await db.query<{ r: { action: string }[] }>(
      "select public.admin_audit_page($1,null,null,100) r",
      [g],
    )
  ).rows[0].r;
  expect(logs.filter((r) => r.action === "session_deleted")).toHaveLength(1);
});
it("deletion checks membership, revision and finalized money on the server", async () => {
  const sid = await create();
  await actor(c);
  await expect(
    db.query("select public.delete_unfinalized_session($1,0)", [sid]),
  ).rejects.toThrow(/quyền/);
  await actor(b);
  await expect(
    db.query("select public.delete_unfinalized_session($1,99)", [sid]),
  ).rejects.toThrow(/thay đổi/);
  await db.exec("reset role");
  await db.query(
    "update public.sessions set costs_finalized_at=now(),status='played' where id=$1",
    [sid],
  );
  await actor(a);
  await expect(
    db.query("select public.delete_unfinalized_session($1,0)", [sid]),
  ).rejects.toThrow(/chưa chốt/);
});
it("audit access is admin-only, isolated by group and immutable with no copied bank values", async () => {
  await actor(b);
  expect((await db.query("select * from public.audit_log")).rows).toHaveLength(
    0,
  );
  await expect(
    db.query("select public.admin_audit_page(null,null,null,30)"),
  ).rejects.toThrow(/admin/);
  await actor(a);
  await expect(
    db.query("select public.admin_audit_page($1,null,null,30)", [other]),
  ).rejects.toThrow(/admin/);
  const rows = (
    await db.query<{
      r: {
        id: string;
        created_at: string;
        group_id: string;
        payload: unknown;
      }[];
    }>("select public.admin_audit_page(null,null,null,100) r")
  ).rows[0].r;
  expect(rows.every((r) => r.group_id === g)).toBe(true);
  expect(JSON.stringify(rows)).not.toContain("00001234987654321");
  expect(JSON.stringify(rows)).not.toContain("PRIVATE HOLDER");
  await expect(
    db.query("update public.audit_log set action='fake'"),
  ).rejects.toThrow();
  await expect(
    db.query(
      "insert into public.audit_log(group_id,action) values($1,'fake')",
      [g],
    ),
  ).rejects.toThrow();
  await db.exec("reset role");
  await expect(db.exec("delete from public.audit_log")).rejects.toThrow();
});
it("audit pagination does not skip logs with identical timestamps", async () => {
  await db.exec("reset role");
  for (let i = 0; i < 35; i++)
    await db.query(
      "insert into public.audit_log(group_id,actor_id,action,created_at) values($1,$2,'pagination',now()+interval '1 day')",
      [g, a],
    );
  await actor(a);
  const first = (
    await db.query<{ r: { id: string; created_at: string }[] }>(
      "select public.admin_audit_page($1,null,null,20) r",
      [g],
    )
  ).rows[0].r;
  const last = first.at(-1)!;
  const next = (
    await db.query<{ r: { id: string }[] }>(
      "select public.admin_audit_page($1,$2,$3,20) r",
      [g, last.created_at, last.id],
    )
  ).rows[0].r;
  expect(new Set([...first, ...next].map((r) => r.id)).size).toBe(
    first.length + next.length,
  );
});
it("retired scheduling polls cannot be created, voted, converted or invoked through AI", async () => {
  await actor(a);
  for (const sql of [
    "select public.create_poll($1,'Retired','Court',1,now()+interval '1 hour','[]'::jsonb)",
    "select public.vote_poll($1,'yes')",
    "select public.finish_poll($1)",
    "select public.close_poll($1,$1)",
    "select public.schedule_poll_meeting($1,$1,$1,'{}'::jsonb)",
    "select public.create_ai_draft($1,'create_poll','{}'::jsonb)",
    "select public.create_ai_draft($1,'vote','{}'::jsonb)",
  ]) {
    await expect(db.query(sql, [g])).rejects.toThrow(/đã được gỡ/);
  }
  expect((await db.query("select id from public.polls")).rows).toHaveLength(0);
});
it("group admins toggle AI directly, nonadmins cannot, quota and encrypted-key privacy remain", async () => {
  const config = {
    status: "approved",
    provider: "google",
    model: "test",
    suffix: "1234",
    message_limit: 30,
    token_limit: 100000,
    reason: "Direct admin config",
    enabled: true,
  };
  const env = {
    version: 1,
    iv: "iv",
    tag: "tag",
    ciphertext: "NEVER_LOG_CREDENTIAL",
  };
  await actor(b);
  await expect(
    db.query("select public.configure_group_ai($1,-1,$2,$3)", [g, config, env]),
  ).rejects.toThrow(/admin/);
  await actor(a);
  await db.query("select public.configure_group_ai($1,-1,$2,$3)", [
    g,
    config,
    env,
  ]);
  await actor(b);
  await expect(
    db.query("select public.set_group_ai_enabled($1,0,false)", [g]),
  ).rejects.toThrow(/admin/);
  await actor(a);
  await db.query("select public.set_group_ai_enabled($1,0,false)", [g]);
  await expect(
    db.query("select public.reserve_ai_run($1,'test',1000)", [g]),
  ).rejects.toThrow(/chưa bật/);
  await expect(
    db.query("select public.set_group_ai_enabled($1,0,true)", [g]),
  ).rejects.toThrow(/thay đổi/);
  await db.query("select public.set_group_ai_enabled($1,1,true)", [g]);
  expect(
    (
      await db.query<{ status: string; enabled: boolean }>(
        "select status,enabled from public.group_ai_settings where group_id=$1",
        [g],
      )
    ).rows[0],
  ).toEqual({ status: "approved", enabled: true });
  await expect(
    db.query("select * from app_private.ai_credentials"),
  ).rejects.toThrow();
  const logs = (await db.query("select payload from public.audit_log")).rows;
  expect(JSON.stringify(logs)).not.toContain("NEVER_LOG_CREDENTIAL");
});
