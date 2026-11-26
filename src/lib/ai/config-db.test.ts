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

it("lets group admins configure AI directly without a request while members cannot and credentials stay private", async () => {
  const config = {
    status: "approved",
    provider: "google",
    model: "test",
    suffix: "1234",
    message_limit: 2,
    token_limit: 20000,
    reason: "Test",
    enabled: true,
  };
  const envelope = {
    version: 1,
    iv: "abc",
    tag: "abc",
    ciphertext: "encrypted",
  };
  await actor(b);
  await expect(
    db.query("select public.configure_group_ai($1,-1,$2,$3)", [
      group,
      JSON.stringify(config),
      JSON.stringify(envelope),
    ]),
  ).rejects.toThrow();
  await actor(a);
  await db.query("select public.configure_group_ai($1,-1,$2,$3)", [
    group,
    JSON.stringify(config),
    JSON.stringify(envelope),
  ]);
  expect(
    (
      await db.query<{ status: string; enabled: boolean }>(
        "select status,enabled from public.group_ai_settings where group_id=$1",
        [group],
      )
    ).rows[0],
  ).toEqual({ status: "approved", enabled: true });
  await expect(
    db.query("select public.read_ai_credential($1)", [group]),
  ).rejects.toThrow();
  await expect(
    db.query("select * from app_private.ai_credentials"),
  ).rejects.toThrow();
  await actor(b);
  expect(
    (
      await db.query(
        "select * from public.group_ai_settings where group_id=$1",
        [group],
      )
    ).rows,
  ).toHaveLength(1);
  await actor(c);
  expect(
    (
      await db.query(
        "select * from public.group_ai_settings where group_id=$1",
        [group],
      )
    ).rows,
  ).toHaveLength(0);
});

it("reserves quota atomically, prevents cross-group access and respects immediate kill switch", async () => {
  await actor(c);
  await expect(
    db.query("select public.reserve_ai_run($1,'v1',10000)", [group]),
  ).rejects.toThrow();
  await actor(b);
  const run = (
    await db.query<{ r: string }>(
      "select public.reserve_ai_run($1,'v1',10000) r",
      [group],
    )
  ).rows[0].r;
  await expect(
    db.query("select public.finish_ai_run($1,1,true)", [run]),
  ).rejects.toThrow();
  await expect(
    db.query("select public.reserve_ai_run($1,'v1',10000)", [group]),
  ).rejects.toThrow();
  await db.exec("reset role");
  await db.query("select public.finish_ai_run($1,9999,true)", [run]);
  await db.query(
    "update public.group_ai_settings set enabled=false where group_id=$1",
    [group],
  );
  await actor(a);
  await expect(
    db.query("select public.reserve_ai_run($1,'v1',10000)", [group]),
  ).rejects.toThrow();
  await db.exec("reset role");
  expect(
    (
      await db.query<{ r: unknown }>("select public.read_ai_credential($1) r", [
        group,
      ])
    ).rows[0].r,
  ).toBe(null);
});
it("enables decision routing only by group admin with a current revision and a supported free model", async () => {
  await db.exec("reset role");
  await db.query(
    "update public.group_ai_settings set enabled=true,provider='openai-compatible',base_url='https://openrouter.ai/api/v1' where group_id=$1",
    [group],
  );
  const r = (
    await db.query<{ revision: string }>(
      "select revision::text revision from public.group_ai_settings where group_id=$1",
      [group],
    )
  ).rows[0].revision;
  await actor(b);
  await expect(
    db.query(
      "select public.configure_group_decisions($1,$2,'perplexity/pplx-decider-flash-v1.3:free','Test')",
      [group, r],
    ),
  ).rejects.toThrow();
  await actor(a);
  await expect(
    db.query(
      "select public.configure_group_decisions($1,$2,'typesafe/jev-router','Test')",
      [group, r],
    ),
  ).rejects.toThrow();
  await expect(
    db.query(
      "select public.configure_group_decisions($1,null,'perplexity/pplx-decider-flash-v1.3:free','Test')",
      [group],
    ),
  ).rejects.toThrow();
  await db.exec("reset role");
  await db.query(
    "update public.group_ai_settings set base_url=null where group_id=$1",
    [group],
  );
  await actor(a);
  await expect(
    db.query(
      "select public.configure_group_decisions($1,$2,'perplexity/pplx-decider-flash-v1.3:free','Test')",
      [group, r],
    ),
  ).rejects.toThrow();
  await db.exec("reset role");
  await db.query(
    "update public.group_ai_settings set base_url='https://openrouter.ai/api/v1' where group_id=$1",
    [group],
  );
  await actor(a);
  await db.query(
    "select public.configure_group_decisions($1,$2,'perplexity/pplx-decider-flash-v1.3:free','Test')",
    [group, r],
  );
  expect(
    (
      await db.query<{ decision_model: string }>(
        "select decision_model from public.group_ai_settings where group_id=$1",
        [group],
      )
    ).rows[0].decision_model,
  ).toBe("perplexity/pplx-decider-flash-v1.3:free");
  await expect(
    db.query("select public.configure_group_decisions($1,$2,null,'Test')", [
      group,
      r,
    ]),
  ).rejects.toThrow();
  await expect(
    db.query(
      "update public.group_ai_settings set decision_model=null where group_id=$1",
      [group],
    ),
  ).rejects.toThrow();
});
