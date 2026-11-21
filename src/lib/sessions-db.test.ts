import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
import { splitExpense } from "./expense-calculation";
let db: PGlite;
let group: string;
let people: string[];
let sid: string;
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  outside = "00000000-0000-0000-0000-000000000003";
async function actor(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function details() {
  return (
    await db.query<{
      d: {
        revision: string;
        status: string;
        expenses: { amount: string; allocations: { amount: string }[] }[];
        settlements: {
          id: string;
          from_member: string;
          to_member: string;
          amount: string;
          status: string;
        }[];
      };
    }>("select public.session_details($1) d", [sid])
  ).rows[0].d;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to public;`,
  );
  await db.exec('alter default privileges in schema public grant all on tables to anon,authenticated,service_role');
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
    "insert into auth.users(id,email,email_confirmed_at) values($1,'a@test.local',now()),($2,'b@test.local',now()),($3,'out@test.local',now())",
    [a, b, outside],
  );
  group = (
    await db.query<{ id: string }>(
      "select public.provision_group($1,'Sports','Tennis') id",
      [a],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'B')",
    [group, b],
  );
  people = (
    await db.query<{ id: string }>(
      "select id from public.group_members where group_id=$1 order by user_id",
      [group],
    )
  ).rows.map((x) => x.id);
  await actor(a);
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'A','970415','12345678','A')",
    [a],
  );
  sid = (
    await db.query<{ id: string }>(
      "select public.create_session($1,'Test','Court',now()-interval '1 hour',now()-interval '1 hour',true,$2,'101250',true) id",
      [group, people],
    )
  ).rows[0].id;
}, 30000);
afterAll(async () => {
  await db?.close();
});
it("allocations conserve integer VND and text DTOs preserve precision", async () => {
  const d = await details();
  expect(d.expenses[0].amount).toBe("101250");
  expect(
    d.expenses[0].allocations.reduce((sum, x) => sum + BigInt(x.amount), 0n),
  ).toBe(101250n);
  expect(d.settlements).toHaveLength(1);
  expect(d.settlements[0].from_member).toBe(people[1]);
});
it("creator/member cannot edit money unless they are the collector; outsiders cannot read", async () => {
  await actor(b);
  await expect(
    db.query(
      "select public.add_expense($1,$2,'Extra','1000',$3,$4,'total','equal','{}','reason')",
      [sid, (await details()).revision, people[1], people],
    ),
  ).rejects.toThrow(/người tính tiền/);
  await actor(outside);
  await expect(details()).rejects.toThrow(/quyền/);
  await actor(a);
  await expect(
    db.query("select public.recalculate_session($1,'bypass')", [sid]),
  ).rejects.toThrow(/permission denied/);
});
it("confirmed transfers stay immutable when discounts create refunds", async () => {
  await actor(b);
  let d = await details();
  await db.query("select public.payment_action($1,'mark')", [
    d.settlements[0].id,
  ]);
  await actor(a);
  await db.query("select public.payment_action($1,'confirm')", [
    d.settlements[0].id,
  ]);
  d = await details();
  const original = d.settlements[0];
  expect(d.status).toBe("settled");
  await db.query(
    "select public.add_expense($1,$2,'Discount','-20000',$3,$4,'total','equal','{}','Discount applied')",
    [sid, d.revision, people[0], people],
  );
  d = await details();
  expect(d.settlements.find((x) => x.id === original.id)).toMatchObject({
    status: "confirmed",
    amount: original.amount,
  });
  expect(d.settlements.find((x) => x.status === "pending")).toMatchObject({
    from_member: people[0],
    to_member: people[1],
    amount: "10000",
  });
  expect(d.status).toBe("played");
});
it.each([
  ["total", "percent", "10000", ["25", "75"]],
  ["total", "exact", "10000", ["3000", "7000"]],
  ["per_person", "equal", "5000", []],
  ["total", "weighted", "10000", []],
  ["total", "equal", "0", []],
])("handles %s/%s", async (mode, split, amount, values) => {
  await actor(a);
  const d = await details();
  await db.query(
    "select public.add_expense($1,$2,'Extra',$3,$4,$5,$6,$7,$8,'Adjustment')",
    [sid, d.revision, amount, people[1], people, mode, split, values],
  );
  const after = await details();
  const e = after.expenses.at(-1)!;
  expect(e.allocations.reduce((sum, x) => sum + BigInt(x.amount), 0n)).toBe(
    BigInt(e.amount),
  );
});
it("stale revisions and invalid percentage sums cannot partially write", async () => {
  await actor(a);
  const d = await details();
  await expect(
    db.query(
      "select public.add_expense($1,'0','Bad','10000',$2,$3,'total','equal','{}','reason')",
      [sid, people[0], people],
    ),
  ).rejects.toThrow(/thay đổi/);
  await expect(
    db.query(
      "select public.add_expense($1,$2,'Bad','10000',$3,$4,'total','percent',array['50','40'],'reason')",
      [sid, d.revision, people[0], people],
    ),
  ).rejects.toThrow(/khớp/);
  expect((await details()).expenses).toHaveLength(d.expenses.length);
});
it("RSVP acts only on the caller and refuses late changes", async () => {
  await actor(a);
  const planned = (
    await db.query<{ id: string }>(
      "select public.create_session($1,'Future','Court',now()+interval '2 hours',now()+interval '1 hour',false,'{}','0',false) id",
      [group],
    )
  ).rows[0].id;
  await actor(b);
  await db.query("select public.set_rsvp($1,true)", [planned]);
  const rows = await db.query<{ member_id: string }>(
    "select member_id from public.session_attendees where session_id=$1",
    [planned],
  );
  expect(rows.rows.map((r) => r.member_id)).toEqual([people[1]]);
  await expect(
    db.query("select public.set_rsvp($1,false)", [sid]),
  ).rejects.toThrow(/hạn chốt/);
});

it("preview rolls back all writes; removing a paid attendee creates a refund", async () => {
  await actor(a);
  const newId = (
    await db.query<{ id: string }>(
      "select public.create_session($1,'Refund test','Court',now()-interval '1 hour',now()-interval '1 hour',true,$2,'100000',true) id",
      [group, people],
    )
  ).rows[0].id;
  const before = (
    await db.query<{
      d: { revision: string; settlements: { id: string; status: string }[] };
    }>("select public.session_details($1) d", [newId])
  ).rows[0].d;
  await db.query("select public.payment_action($1,'confirm')", [
    before.settlements[0].id,
  ]);
  const paid = (
    await db.query<{
      d: { revision: string; settlements: { id: string; status: string }[] };
    }>("select public.session_details($1) d", [newId])
  ).rows[0].d;
  const body = {
    member_id: people[1],
    operation: "remove",
    reason: "Recorded wrong attendee",
  };
  const preview = (
    await db.query<{
      d: {
        settlements: {
          amount: string;
          from_member: string;
          to_member: string;
          status: string;
        }[];
      };
    }>("select public.preview_financial_change($1,$2,'attendee',$3) d", [
      newId,
      paid.revision,
      body,
    ])
  ).rows[0].d;
  expect(preview.settlements.find((p) => p.status === "pending")).toMatchObject(
    { amount: "50000", from_member: people[0], to_member: people[1] },
  );
  expect(
    (
      await db.query<{ d: unknown }>("select public.session_details($1) d", [
        newId,
      ])
    ).rows[0].d,
  ).toEqual(paid);
  await db.query("select public.apply_financial_change($1,$2,'attendee',$3)", [
    newId,
    paid.revision,
    body,
  ]);
  const after = (
    await db.query<{
      d: { settlements: { status: string; amount: string }[] };
    }>("select public.session_details($1) d", [newId])
  ).rows[0].d;
  expect(after.settlements.find((p) => p.status === "confirmed")?.amount).toBe(
    "50000",
  );
  expect(after.settlements.find((p) => p.status === "pending")?.amount).toBe(
    "50000",
  );
  await actor(b);
  await expect(
    db.query("select public.apply_financial_change($1,$2,'attendee',$3)", [
      newId,
      paid.revision,
      body,
    ]),
  ).rejects.toThrow(/người tính tiền/);
});
it("partial confirmations invalidate old previews and repeated confirmation is idempotent", async () => {
  await db.exec("reset role");
  const guest = (
    await db.query<{ id: string }>(
      "insert into public.group_members(group_id,display_name) values($1,'Guest') returning id",
      [group],
    )
  ).rows[0].id;
  await actor(a);
  const id = (
    await db.query<{ id: string }>(
      "select public.create_session($1,'Three','Court',now()-interval '1 hour',now()-interval '1 hour',true,$2,'300000',true) id",
      [group, [...people, guest]],
    )
  ).rows[0].id;
  const get = async () =>
    (
      await db.query<{
        d: {
          revision: string;
          settlements: { id: string }[];
          expenses: { id: string }[];
        };
      }>("select public.session_details($1) d", [id])
    ).rows[0].d;
  const original = await get();
  await db.query("select public.payment_action($1,'confirm')", [
    original.settlements[0].id,
  ]);
  const once = await get();
  expect(once.revision).not.toBe(original.revision);
  await db.query("select public.payment_action($1,'confirm')", [
    original.settlements[0].id,
  ]);
  expect((await get()).revision).toBe(once.revision);
  await expect(
    db.query(
      "select public.apply_financial_change($1,$2,'delete_expense',$3)",
      [
        id,
        original.revision,
        { expense_id: original.expenses[0].id, reason: "stale" },
      ],
    ),
  ).rejects.toThrow(/thay đổi/);
});

it("client roles cannot truncate business data, and logs cannot be truncated even by the owner", async () => {
  await actor(a);
  await expect(db.exec("truncate public.settlements cascade")).rejects.toThrow(
    /permission denied/,
  );
  await db.exec("reset role");
  await expect(db.exec("truncate public.audit_log")).rejects.toThrow(
    /bất biến/,
  );
  await expect(db.exec("truncate public.attendance_events")).rejects.toThrow(
    /bất biến/,
  );
});
it("SQL Hamilton results match the TypeScript preview with negative amounts and zero shares", async () => {
  await actor(a);
  for (const [amount, split, values] of [
    ["1250", "equal", []],
    ["-1250", "equal", []],
    ["11250", "exact", ["0", "11250"]],
    ["11111", "percent", ["12.5", "87.5"]],
  ] as const) {
    const before = await details();
    await db.query(
      "select public.add_expense($1,$2,'Golden',$3,$4,$5,'total',$6,$7,'Golden case')",
      [sid, before.revision, amount, people[0], people, split, [...values]],
    );
    const e = (await details()).expenses.at(-1)!;
    const expected = splitExpense(
      BigInt(amount),
      "total",
      split,
      people.map((id, i) => ({ id, value: values[i as 0] || "1" })),
      people[0],
    );
    expect(e.allocations.map((x) => x.amount).sort()).toEqual(
      expected.shares.map((x) => x.amount.toString()).sort(),
    );
  }
});
