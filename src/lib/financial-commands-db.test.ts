import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
let group: string;
let members: string[];
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  outsider = "00000000-0000-0000-0000-000000000003";
type Result = {
  id: string | null;
  session_id: string;
  revision: string;
  batch_id: string | null;
  replayed: boolean;
};
async function actor(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function command(
  name: string,
  body: Record<string, unknown>,
  key = randomUUID(),
) {
  return (
    await db.query<{ result: Result }>(
      "select public.execute_financial_command($1,$2,$3) result",
      [name, key, JSON.stringify(body)],
    )
  ).rows[0].result;
}
async function session() {
  await actor(a);
  const starts = new Date(Date.now() - 3600000).toISOString();
  return command("create_session", {
    g: group,
    title_text: "Money retries",
    venue_text: "Court",
    start_time: starts,
    deadline: starts,
    already_played: true,
    people: members,
    court: "100000",
    be_collector: true,
  });
}
async function detail(sid: string) {
  return (
    await db.query<{
      d: {
        revision: string;
        settlements: { id: string; status: string; amount: string }[];
      };
    }>("select public.session_details($1) d", [sid])
  ).rows[0].d;
}
function extra(s: Result) {
  return {
    sid: s.session_id,
    expected_revision: s.revision,
    title_text: "Water",
    raw_amount: "20000",
    payer: members[0],
    beneficiaries: members,
    mode: "total",
    split: "equal",
    values_text: [],
    reason: "Water cost",
  };
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
    [a, b, outsider],
  );
  group = (
    await db.query<{ id: string }>(
      "select public.provision_group($1,'Financial commands','Sport') id",
      [a],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'B')",
    [group, b],
  );
  members = (
    await db.query<{ id: string }>(
      "select id from public.group_members where group_id=$1 order by user_id",
      [group],
    )
  ).rows.map((m) => m.id);
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'A','970415','12345678','A')",
    [a],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});

it("session creation reuses an explicit request key while distinct keys remain distinct intentions", async () => {
  await actor(a);
  const starts = new Date(Date.now() + 86400000).toISOString();
  const body = {
    g: group,
    title_text: "Future retry",
    venue_text: "Court",
    start_time: starts,
    deadline: starts,
    already_played: false,
    people: [],
    court: "0",
    be_collector: false,
  };
  const key = randomUUID();
  const first = await command("create_session", body, key);
  expect(await command("create_session", body, key)).toEqual({
    ...first,
    replayed: true,
  });
  expect((await command("create_session", body)).id).not.toBe(first.id);
});

it("retries return the committed result without creating another expense, batch, notification or audit event", async () => {
  const s = await session(),
    key = randomUUID(),
    body = extra(s);
  const saved = await command("add_expense", body, key);
  const counts = async () =>
    (
      await db.query(
        "select (select count(*) from public.expenses where session_id=$1)::text expenses,(select count(*) from public.session_recalculations where session_id=$1)::text batches,(select count(*) from public.audit_log where session_id=$1)::text audits,(select count(*) from public.notifications where group_id=$2)::text notifications",
        [s.session_id, group],
      )
    ).rows[0];
  const before = await counts();
  expect(await command("add_expense", body, key)).toEqual({
    ...saved,
    replayed: true,
  });
  expect(await counts()).toEqual(before);
  expect((await detail(s.session_id)).revision).toBe(saved.revision);
  await expect(
    command("add_expense", { ...body, raw_amount: "30000" }, key),
  ).rejects.toThrow(/nội dung khác/);
  await expect(command("add_expense", body)).rejects.toThrow(/thay đổi/);
});
it("retries and fresh keys cannot grant a member expense authority", async () => {
  const s = await session();
  await actor(b);
  const body = { ...extra(s), payer: members[1] },
    key = randomUUID();
  for (const k of [key, key, randomUUID()])
    await expect(command("add_expense", body, k)).rejects.toThrow(
      /người tính tiền/,
    );
  expect((await detail(s.session_id)).revision).toBe(s.revision);
  expect(
    (
      await db.query(
        "select id from public.approval_requests where session_id=$1",
        [s.session_id],
      )
    ).rows,
  ).toHaveLength(0);
});
it("failed commands reserve no result and may be corrected with the same key", async () => {
  const s = await session(),
    key = randomUUID();
  await expect(
    command("add_expense", { ...extra(s), raw_amount: "invalid" }, key),
  ).rejects.toThrow();
  const result = await command("add_expense", extra(s), key);
  expect(result.replayed).toBe(false);
  expect(result.batch_id).not.toBeNull();
  await expect(
    command("add_expense", { ...extra(result), expected_revision: null }),
  ).rejects.toThrow(/không hợp lệ/);
  await expect(
    command("add_expense", { ...extra(result), payer: { id: members[0] } }),
  ).rejects.toThrow(/không hợp lệ/);
});
it("previews roll back batches/links and a stale preview cannot be saved with a fresh key", async () => {
  const s = await session();
  const change = {
    sid: s.session_id,
    expected_revision: s.revision,
    action_name: "delete_expense",
    body: {
      expense_id: (
        await db.query<{ id: string }>(
          "select id from public.expenses where session_id=$1 limit 1",
          [s.session_id],
        )
      ).rows[0].id,
      reason: "Preview deletion",
    },
  };
  await db.query("select public.preview_financial_change($1,$2,$3,$4)", [
    s.session_id,
    s.revision,
    change.action_name,
    change.body,
  ]);
  expect(
    (
      await db.query(
        "select id from public.session_recalculations where session_id=$1",
        [s.session_id],
      )
    ).rows,
  ).toHaveLength(1);
  const prior = await command("add_expense", extra(s));
  await expect(command("apply_financial_change", change)).rejects.toThrow(
    /thay đổi/,
  );
  expect((await detail(s.session_id)).revision).toBe(prior.revision);
});
it("issued/cancelled transfers point to their immutable batches and confirmed rows remain untouched", async () => {
  const s = await session();
  const initial = (await detail(s.session_id)).settlements[0];
  const saved = await command("add_expense", extra(s));
  const old = (
    await db.query<{ cancelled_by_recalculation_id: string }>(
      "select cancelled_by_recalculation_id from public.settlements where id=$1",
      [initial.id],
    )
  ).rows[0];
  expect(old.cancelled_by_recalculation_id).toBe(saved.batch_id);
  const payment = (await detail(s.session_id)).settlements.find(
    (p) => p.status === "pending",
  )!;
  const confirmKey = randomUUID(),
    confirmBody = { target: payment.id, operation: "confirm" };
  await command("payment_action", confirmBody, confirmKey);
  const confirmed = (
    await db.query<{ p: Record<string, unknown> }>(
      "select to_jsonb(p) p from public.settlements p where id=$1",
      [payment.id],
    )
  ).rows[0].p;
  const baseline = (await detail(s.session_id)).revision;
  const changed = await command("add_expense", {
    ...extra(s),
    expected_revision: baseline,
    raw_amount: "10000",
  });
  expect(
    (
      await db.query<{ p: Record<string, unknown> }>(
        "select to_jsonb(p) p from public.settlements p where id=$1",
        [payment.id],
      )
    ).rows[0].p,
  ).toEqual(confirmed);
  expect(
    (await command("payment_action", confirmBody, confirmKey)).replayed,
  ).toBe(true);
  expect((await detail(s.session_id)).revision).toBe(changed.revision);
  const batches = (
    await db.query<{
      id: string;
      previous_id: string | null;
      snapshot_before: { settlements: { amount: string }[] };
      snapshot_after: { allocations: { amount: string }[] };
    }>(
      "select * from public.session_recalculations where session_id=$1 order by revision_after",
      [s.session_id],
    )
  ).rows;
  expect(batches.map((x) => x.previous_id)).toEqual([
    null,
    s.batch_id,
    saved.batch_id,
  ]);
  expect(
    batches[2].snapshot_before.settlements.some((x) => x.amount === "60000"),
  ).toBe(true);
  expect(
    batches[2].snapshot_after.allocations.reduce(
      (sum, x) => sum + BigInt(x.amount),
      0n,
    ),
  ).toBe(130000n);
  expect(
    (
      await db.query<{ recalculation_id: string }>(
        "select recalculation_id from public.settlements where session_id=$1 and status='pending'",
        [s.session_id],
      )
    ).rows.every((x) => x.recalculation_id === changed.batch_id),
  ).toBe(true);
  await db.exec("reset role");
  await expect(
    db.query(
      "update public.session_recalculations set reason='Changed' where id=$1",
      [s.batch_id],
    ),
  ).rejects.toThrow(/bất biến/);
  await expect(
    db.query("delete from public.session_recalculations where id=$1", [
      s.batch_id,
    ]),
  ).rejects.toThrow(/bất biến/);
});
it("private cores/receipts are inaccessible, outsiders see no batches and removed members cannot replay", async () => {
  const s = await session(),
    key = randomUUID(),
    body = extra(s);
  await command("add_expense", body, key);
  await actor(outsider);
  expect(
    (
      await db.query(
        "select id from public.session_recalculations where session_id=$1",
        [s.session_id],
      )
    ).rows,
  ).toHaveLength(0);
  await expect(command("add_expense", body, key)).rejects.toThrow(/quyền/);
  await actor(a);
  await expect(
    db.query("select * from app_private.financial_command_results"),
  ).rejects.toThrow();
  await expect(
    db.query("select app_private.payment_action($1,'confirm')", [
      (await detail(s.session_id)).settlements[0].id,
    ]),
  ).rejects.toThrow();
  await db.exec("reset role");
  await db.query(
    "update public.group_members set status='removed' where id=$1",
    [members[0]],
  );
  await actor(a);
  await expect(command("add_expense", body, key)).rejects.toThrow(/quyền/);
  await db.exec("reset role");
  await db.query(
    "update public.group_members set status='active' where id=$1",
    [members[0]],
  );
});
