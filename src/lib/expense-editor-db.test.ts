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
it("seeds group categories/templates and encodes template amounts as strings", async () => {
  await actor(a);
  const tools = (
    await db.query<{
      t: { categories: unknown[]; templates: { amount: string }[] };
    }>("select public.expense_tools($1) t", [group])
  ).rows[0].t;
  expect(tools.categories).toHaveLength(7);
  expect(tools.templates).toHaveLength(2);
  expect(tools.templates.every((x) => typeof x.amount === "string")).toBe(true);
});
it("catalog management is admin-only and rejects foreign category IDs", async () => {
  await actor(b);
  await expect(
    db.query(
      "select public.save_expense_category($1,null,'Custom','other',10,true,'Reason')",
      [group],
    ),
  ).rejects.toThrow(/admin/);
  await actor(a);
  const id = (
    await db.query<{ id: string }>(
      "select public.save_expense_category($1,null,'Custom','other',10,true,'Reason') id",
      [group],
    )
  ).rows[0].id;
  await db.query(
    "select public.save_expense_category($1,$2,'Custom','other',10,false,'Archive')",
    [group, id],
  );
  const sid = await session();
  await expect(save(await body(sid, { category_id: id }))).rejects.toThrow(
    /Danh mục/,
  );
  await db.exec("reset role");
  const foreign = (
    await db.query<{ id: string }>(
      "select public.provision_group($1,'Foreign','Sport') id",
      [c],
    )
  ).rows[0].id;
  const foreignCategory = (
    await db.query<{ id: string }>(
      "select id from public.group_expense_categories where group_id=$1 limit 1",
      [foreign],
    )
  ).rows[0].id;
  await actor(a);
  await expect(
    save(await body(sid, { category_id: foreignCategory })),
  ).rejects.toThrow(/Danh mục/);
  await actor(c);
  expect(
    (
      await db.query(
        "select * from public.group_expense_categories where group_id=$1",
        [group],
      )
    ).rows,
  ).toHaveLength(0);
});
it("editing an active expense keeps its ID/authorship and reconciles confirmed cash flows with a top-up", async () => {
  const sid = await session();
  const created = await save(await body(sid));
  const payment = (
    await db.query<{ id: string }>(
      "select id from public.settlements where session_id=$1 and status='pending'",
      [sid],
    )
  ).rows[0].id;
  await db.query("select public.payment_action($1,'confirm')", [payment]);
  const payload = await body(sid, {
    expense_id: created.id,
    raw_amount: "30000",
  });
  await db.query("select public.preview_expense_edit($1,$2,$3)", [
    sid,
    await revision(sid),
    payload,
  ]);
  expect(
    (
      await db.query<{ a: string }>(
        "select amount::text a from public.expenses where id=$1",
        [created.id],
      )
    ).rows[0].a,
  ).toBe("20000");
  const key = randomUUID();
  await save(payload, key);
  expect((await save(payload, key)).replayed).toBe(true);
  const edited = (
    await db.query<{ amount: string; created_by: string; note: string }>(
      "select amount::text,created_by,note from public.expenses where id=$1",
      [created.id],
    )
  ).rows[0];
  expect(edited.amount).toBe("30000");
  expect(edited.created_by).toBe(a);
  expect(edited.note).toBe("Receipt note");
  expect(
    (
      await db.query<{ amount: string; status: string }>(
        "select amount::text,status from public.settlements where id=$1",
        [payment],
      )
    ).rows[0],
  ).toEqual({ amount: "60000", status: "confirmed" });
  expect(
    (
      await db.query<{ a: string }>(
        "select amount::text a from public.settlements where session_id=$1 and status='pending'",
        [sid],
      )
    ).rows[0].a,
  ).toBe("5000");
});
it("non-collectors cannot create expense proposals", async () => {
  const sid = await session(),
    before = await revision(sid);
  await actor(b);
  await expect(
    save(await body(sid, { payer: bm, beneficiaries: [bm] })),
  ).rejects.toThrow(/người tính tiền/);
  await expect(save(await body(sid, { payer: bm }))).rejects.toThrow(
    /người tính tiền/,
  );
  expect(await revision(sid)).toBe(before);
  const editors = (
    await db.query<{ d: { can_edit: boolean }[] }>(
      "select public.expense_editor_data($1) d",
      [sid],
    )
  ).rows[0].d;
  expect(editors.every((e) => !e.can_edit)).toBe(true);
});
it("failed member expense attempts do not advance the session revision", async () => {
  const sid = await session(),
    before = await revision(sid);
  await actor(b);
  await expect(
    save(await body(sid, { payer: bm, beneficiaries: [bm] })),
  ).rejects.toThrow(/người tính tiền/);
  await expect(save(await body(sid, { payer: bm }))).rejects.toThrow(
    /người tính tiền/,
  );
  expect(await revision(sid)).toBe(before);
  const editors = (
    await db.query<{ d: { can_edit: boolean }[] }>(
      "select public.expense_editor_data($1) d",
      [sid],
    )
  ).rows[0].d;
  expect(editors.every((e) => !e.can_edit)).toBe(true);
});
it("self-only expense entry and court editing require the collector", async () => {
  const sid = await session(),
    before = await revision(sid);
  await actor(b);
  await expect(
    save(await body(sid, { payer: bm, beneficiaries: [bm] })),
  ).rejects.toThrow(/người tính tiền/);
  await expect(save(await body(sid, { payer: bm }))).rejects.toThrow(
    /người tính tiền/,
  );
  expect(await revision(sid)).toBe(before);
  const editors = (
    await db.query<{ d: { can_edit: boolean }[] }>(
      "select public.expense_editor_data($1) d",
      [sid],
    )
  ).rows[0].d;
  expect(editors.every((e) => !e.can_edit)).toBe(true);
});
it("court edits enforce the current collector and full weighted attendance", async () => {
  const sid = await session();
  const court = (
    await db.query<{ id: string }>(
      "select id from public.expenses where session_id=$1 and kind='court'",
      [sid],
    )
  ).rows[0].id;
  await save(
    await body(sid, {
      expense_id: court,
      raw_amount: "120000",
      payer: bm,
      beneficiaries: [bm],
      split: "equal",
      category_id: "",
    }),
  );
  const row = (
    await db.query<{ paid_by: string; split_mode: string }>(
      "select paid_by,split_mode from public.expenses where id=$1",
      [court],
    )
  ).rows[0];
  expect(row.paid_by).toBe(am);
  expect(row.split_mode).toBe("weighted");
  expect(
    (
      await db.query(
        "select member_id from public.expense_allocations where expense_id=$1",
        [court],
      )
    ).rows,
  ).toHaveLength(2);
});

it("an admin cannot author invoices on behalf of a legacy guest collector", async () => {
  const sid = await session();
  await db.exec("reset role");
  const guest = (
    await db.query<{ id: string }>(
      "insert into public.group_members(group_id,display_name) values($1,'Guest') returning id",
      [group],
    )
  ).rows[0].id;
  await db.query(
    "update public.sessions set collector_member_id=$2 where id=$1",
    [sid, guest],
  );
  await actor(a);
  await expect(save(await body(sid))).rejects.toThrow(/người tính tiền/);
  await expect(
    db.query(
      "select public.preview_admin_financial($1,$2,'save_expense',$3,'Try',null)",
      [sid, await revision(sid), await body(sid)],
    ),
  ).rejects.toThrow(/người tính tiền/);
});
