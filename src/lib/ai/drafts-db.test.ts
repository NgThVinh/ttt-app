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

async function enable() {
  await db.exec("reset role");
  await db.query(
    "insert into public.group_ai_settings(group_id,status,enabled,provider,model,key_suffix,request_reason,requested_by) values($1,'approved',true,'google','test','1234','Test',$2) on conflict(group_id) do update set enabled=true",
    [group, a],
  );
}
async function draft(command: string, body: Record<string, unknown>) {
  return (
    await db.query<{ r: { id: string; hash: string; tier: string } }>(
      "select public.create_ai_draft($1,$2,$3) r",
      [group, command, JSON.stringify(body)],
    )
  ).rows[0].r;
}
it("creates no payment effects until the requester explicitly confirms, then retries once", async () => {
  await enable();
  const sid = await session();
  await actor(b);
  const target = (
    await db.query<{ id: string }>(
      "select id from public.settlements where session_id=$1",
      [sid],
    )
  ).rows[0].id;
  const d = await draft("mark_paid", { target });
  expect(d.tier).toBe("T1");
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.settlements where id=$1",
        [target],
      )
    ).rows[0].status,
  ).toBe("pending");
  await actor(a);
  await expect(
    db.query("select public.decide_ai_draft($1,$2,true)", [d.id, d.hash]),
  ).rejects.toThrow();
  await actor(b);
  await db.query("select public.decide_ai_draft($1,$2,true)", [d.id, d.hash]);
  await db.query("select public.decide_ai_draft($1,$2,true)", [d.id, d.hash]);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.settlements where id=$1",
        [target],
      )
    ).rows[0].status,
  ).toBe("marked_paid");
});
it("rejects T4, cross-group targets, expired and changed previews", async () => {
  await enable();
  const sid = await session();
  await actor(b);
  await expect(draft("configure_ai", {})).rejects.toThrow();
  await expect(
    draft("rsvp", { sid: randomUUID(), going: true }),
  ).rejects.toThrow();
  const target = (
    await db.query<{ id: string }>(
      "select id from public.settlements where session_id=$1",
      [sid],
    )
  ).rows[0].id;
  const d = await draft("mark_paid", { target });
  await expect(
    db.query("select public.decide_ai_draft($1,$2,true)", [
      d.id,
      "0".repeat(64),
    ]),
  ).rejects.toThrow();
  await db.exec("reset role");
  await db.query(
    "update public.ai_drafts set expires_at=now()-interval '1 minute' where id=$1",
    [d.id],
  );
  await actor(b);
  await expect(
    db.query("select public.decide_ai_draft($1,$2,true)", [d.id, d.hash]),
  ).rejects.toThrow();
});
it("keeps received confirmation T3 and stops when session revision changes", async () => {
  await enable();
  const sid = await session();
  const target = (
    await db.query<{ id: string }>(
      "select id from public.settlements where session_id=$1",
      [sid],
    )
  ).rows[0].id;
  await actor(b);
  await db.query("select public.payment_action($1,'mark')", [target]);
  await actor(a);
  const d = await draft("confirm_received", { target });
  expect(d.tier).toBe("T3");
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.settlements where id=$1",
        [target],
      )
    ).rows[0].status,
  ).toBe("marked_paid");
  await db.exec("reset role");
  await db.query("update public.sessions set revision=revision+1 where id=$1", [
    sid,
  ]);
  await actor(a);
  await expect(
    db.query("select public.decide_ai_draft($1,$2,true)", [d.id, d.hash]),
  ).rejects.toThrow();
});
