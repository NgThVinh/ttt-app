import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite,
  group: string,
  bm: string,
  cm: string,
  guest: string,
  guestSession: string;
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  c = "00000000-0000-0000-0000-000000000003";
async function actor(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function state(sid: string) {
  return (
    await db.query<{
      s: {
        revision: number;
        status: string;
        collector_member_id: string | null;
        unlocked_until: string | null;
      };
    }>("select to_jsonb(s) s from public.sessions s where id=$1", [sid])
  ).rows[0].s;
}
async function played() {
  await actor(b);
  return (
    await db.query<{ id: string }>(
      "select public.create_session($1,$2,'Court',now()-interval '1 hour',now()-interval '1 hour',true,$3,'100000',true) id",
      [group, Math.random().toString(), [bm, cm]],
    )
  ).rows[0].id;
}
type Preview = { id: string; hash: string; detail: { revision: string } };
async function preview(
  sid: string,
  command: string,
  body: Record<string, unknown>,
  source: string | null = null,
  reason = "Admin fallback reason",
) {
  return (
    await db.query<{ p: Preview }>(
      "select public.preview_admin_financial($1,$2,$3,$4,$5,$6) p",
      [
        sid,
        (await state(sid)).revision,
        command,
        JSON.stringify(body),
        reason,
        source,
      ],
    )
  ).rows[0].p;
}
async function apply(p: Preview) {
  await db.query("select public.apply_admin_financial($1,$2)", [p.id, p.hash]);
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
      "select public.provision_group($1,'Fallback','Sport') id",
      [a],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'B'),($1,$3,'C')",
    [group, b, c],
  );
  const people = (
    await db.query<{ id: string; user_id: string }>(
      "select id,user_id from public.group_members where group_id=$1",
      [group],
    )
  ).rows;
  bm = people.find((m) => m.user_id === b)!.id;
  cm = people.find((m) => m.user_id === c)!.id;
  guest = (
    await db.query<{ id: string }>(
      "insert into public.group_members(group_id,display_name) values($1,'Guest collector') returning id",
      [group],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'B','970415','12345678','B')",
    [b],
  );
  await actor(a);
  await db.query(
    "select public.set_guest_bank($1,'970415','87654321','GUEST','Verified guest bank')",
    [guest],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
it("admin status never grants invoice authority or access to private execution context", async () => {
  const sid = await played();
  await actor(a);
  await db.query("select set_config('ttt.admin_fallback','true',false)");
  await expect(
    db.query(
      "select public.add_expense($1,$2,'Water','2000',$3,$4,'total','equal','{}','Admin')",
      [sid, (await state(sid)).revision, bm, [bm, cm]],
    ),
  ).rejects.toThrow(/người tính tiền/);
  await expect(
    preview(sid, "finish_session", { court: "100000" }),
  ).rejects.toThrow(/người tính tiền/);
  await expect(
    db.query(
      "insert into app_private.admin_execution_context values(txid_current(),$1,$2,'save_expense')",
      [a, sid],
    ),
  ).rejects.toThrow();
});
it("a guest cannot be assigned the collector role without personal account acceptance", async () => {
  await actor(c);
  const sid = (
    await db.query<{ id: string }>(
      "select public.create_session($1,'Open','Court',now()+interval '1 day',now()+interval '1 day',false,'{}','0',false) id",
      [group],
    )
  ).rows[0].id;
  await actor(a);
  await expect(
    preview(sid, "assign_guest_collector", { member_id: guest }),
  ).rejects.toThrow(/tự xác nhận/);
  expect((await state(sid)).collector_member_id).toBeNull();
});
it("legacy guest payment receipts retain statement checks and idempotence", async () => {
  await db.exec("reset role");
  guestSession = (
    await db.query<{ id: string }>(
      "insert into public.sessions(group_id,title,venue,starts_at,commit_deadline,status,collector_member_id,created_by) values($1,'Legacy guest','Court',now(),now(),'played',$2,$3) returning id",
      [group, guest, b],
    )
  ).rows[0].id;
  const payment = (
    await db.query<{ id: string }>(
      "insert into public.settlements(session_id,from_member,to_member,amount,ref_code) values($1,$2,$3,50000,'OLD123') returning id",
      [guestSession, bm, guest],
    )
  ).rows[0].id;
  await actor(a);
  await expect(
    preview(guestSession, "payment_action", {
      target: payment,
      operation: "confirm",
      statement_checked: false,
    }),
  ).rejects.toThrow();
  const p = await preview(guestSession, "payment_action", {
    target: payment,
    operation: "confirm",
    statement_checked: true,
  });
  await apply(p);
  const before = await state(guestSession);
  await apply(p);
  expect(await state(guestSession)).toEqual(before);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.settlements where id=$1",
        [payment],
      )
    ).rows[0].status,
  ).toBe("confirmed");
});
it("an admin cannot enter a bill for a legacy guest collector", async () => {
  await actor(a);
  await expect(
    preview(guestSession, "add_expense", {
      title_text: "Water",
      raw_amount: "20000",
      payer: guest,
      beneficiaries: [bm, cm],
      mode: "total",
      split: "equal",
      values_text: [],
    }),
  ).rejects.toThrow(/người tính tiền/);
  expect(
    (
      await db.query("select id from public.expenses where session_id=$1", [
        guestSession,
      ])
    ).rows,
  ).toHaveLength(0);
});
it("a non-admin cannot unlock another member's finalized session", async () => {
  const sid = await played();
  await actor(c);
  await expect(
    db.query("select public.unlock_session($1,$2,'Try')", [
      sid,
      (await state(sid)).revision,
    ]),
  ).rejects.toThrow(/admin/);
});
it("unlock is admin-only, time bounded, public and does not grant the admin financial authority", async () => {
  const sid = await played();
  await db.exec("reset role");
  await db.query(
    "update public.settlements set status='confirmed',confirmed_at=now()-interval '31 days' where session_id=$1",
    [sid],
  );
  await db.query(
    "update public.sessions set status='settled',settled_at=now()-interval '31 days' where id=$1",
    [sid],
  );
  await actor(c);
  await expect(
    db.query("select public.unlock_session($1,$2,'Reason')", [
      sid,
      (await state(sid)).revision,
    ]),
  ).rejects.toThrow(/admin/);
  await actor(a);
  await expect(
    db.query("select public.unlock_session($1,$2,'')", [
      sid,
      (await state(sid)).revision,
    ]),
  ).rejects.toThrow(/lý do/);
  await db.query("select public.unlock_session($1,$2,'Correct old record')", [
    sid,
    (await state(sid)).revision,
  ]);
  expect(
    (
      await db.query<{ locked: boolean }>(
        "select public.session_is_locked($1) locked",
        [sid],
      )
    ).rows[0].locked,
  ).toBe(false);
  await expect(
    db.query("select public.apply_financial_change($1,$2,'attendee',$3)", [
      sid,
      (await state(sid)).revision,
      {
        member_id: cm,
        operation: "weight",
        weight: "0.5",
        reason: "No authority",
      },
    ]),
  ).rejects.toThrow(/người tính tiền/);
  await db.exec("reset role");
  await db.query(
    "update public.sessions set unlocked_until=now()-interval '1 second' where id=$1",
    [sid],
  );
  await actor(b);
  await expect(
    db.query(
      "select public.add_expense($1,$2,'Old fix','1000',$3,$4,'total','equal','{}','Fix')",
      [sid, (await state(sid)).revision, bm, [bm, cm]],
    ),
  ).rejects.toThrow(/khóa/);
  await actor(a);
  await db.query("select public.unlock_session($1,$2,'Renew review')", [
    sid,
    (await state(sid)).revision,
  ]);
  await actor(b);
  await db.query(
    "select public.add_expense($1,$2,'Old fix','1000',$3,$4,'total','equal','{}','Fix')",
    [sid, (await state(sid)).revision, bm, [bm, cm]],
  );
  expect(
    (
      await db.query(
        "select id from public.settlements where session_id=$1 and status='confirmed'",
        [sid],
      )
    ).rows,
  ).toHaveLength(1);
});
