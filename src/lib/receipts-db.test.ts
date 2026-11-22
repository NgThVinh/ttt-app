import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
let group: string;
let payment: string;
let expense: string;
let evidence: string;
let path: string;
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  c = "00000000-0000-0000-0000-000000000003";
async function actor(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to public;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;create schema storage;grant usage on schema storage to authenticated,anon;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated,anon;create policy legacy_broad_access on storage.objects for all to authenticated using(true) with check(true);`,
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
      "select public.provision_group($1,'Receipts','Sport') id",
      [a],
    )
  ).rows[0].id;
  const members = (
    await db.query<{ id: string; user_id: string }>(
      "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'B'),($1,$3,'C') returning id,user_id",
      [group, b, c],
    )
  ).rows;
  const from = members.find((m) => m.user_id === b)!.id;
  const to = (
    await db.query<{ id: string }>(
      "select id from public.group_members where group_id=$1 and user_id=$2",
      [group, a],
    )
  ).rows[0].id;
  const session = (
    await db.query<{ id: string }>(
      "insert into public.sessions(group_id,title,venue,starts_at,commit_deadline,status,collector_member_id,created_by) values($1,'Receipts','Court',now(),now(),'played',$2,$3) returning id",
      [group, to, a],
    )
  ).rows[0].id;
  payment = (
    await db.query<{ id: string }>(
      "insert into public.settlements(session_id,from_member,to_member,amount,ref_code) values($1,$2,$3,10000,'ABC234') returning id",
      [session, from, to],
    )
  ).rows[0].id;
  expense = (
    await db.query<{ id: string }>(
      "insert into public.expenses(session_id,title,amount,paid_by,created_by) values($1,'Court',10000,$2,$3) returning id",
      [session, to, a],
    )
  ).rows[0].id;
}, 30000);
afterAll(async () => {
  await db?.close();
});
it("only the sender can add payment evidence; group membership is insufficient", async () => {
  await actor(c);
  await expect(
    db.query("select public.add_payment_evidence($1,'note',null,'Fake')", [
      payment,
    ]),
  ).rejects.toThrow(/người chuyển/);
  await actor(b);
  evidence = (
    await db.query<{ id: string }>(
      "select public.add_payment_evidence($1,'screenshot') id",
      [payment],
    )
  ).rows[0].id;
  path = (
    await db.query<{ storage_path: string }>(
      "select storage_path from public.payment_evidence where id=$1",
      [evidence],
    )
  ).rows[0].storage_path;
});
it("upload reservations prevent arbitrary paths and finalization needs an uploaded object", async () => {
  await actor(b);
  await expect(
    db.query("select public.finalize_receipt('3t-payment-evidence',$1)", [
      evidence,
    ]),
  ).rejects.toThrow(/Ảnh/);
  await expect(
    db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('3t-payment-evidence','arbitrary.jpg','{}')",
    ),
  ).rejects.toThrow();
  await db.query(
    'insert into storage.objects(bucket_id,name,metadata) values(\'3t-payment-evidence\',$1,\'{"size":100,"mimetype":"image/jpeg"}\')',
    [path],
  );
  await db.query("select public.finalize_receipt('3t-payment-evidence',$1)", [
    evidence,
  ]);
});
it("legacy broad policies cannot expose proofs to ordinary members or allow overwrite/delete", async () => {
  await actor(c);
  expect(
    (
      await db.query("select * from public.payment_evidence where id=$1", [
        evidence,
      ])
    ).rows,
  ).toHaveLength(0);
  expect(
    (await db.query("select * from storage.objects where name=$1", [path]))
      .rows,
  ).toHaveLength(0);
  await actor(a);
  expect(
    (await db.query("select * from storage.objects where name=$1", [path]))
      .rows,
  ).toHaveLength(1);
  await db.query("update storage.objects set metadata='{}' where name=$1", [
    path,
  ]);
  expect(
    (
      await db.query<{ metadata: { size: number } }>(
        "select metadata from storage.objects where name=$1",
        [path],
      )
    ).rows[0].metadata.size,
  ).toBe(100);
  await db.query("delete from storage.objects where name=$1", [path]);
  expect(
    (await db.query("select * from storage.objects where name=$1", [path]))
      .rows,
  ).toHaveLength(1);
});
it("invoices are group-readable but upload remains restricted to the author/collector", async () => {
  await actor(a);
  const id = (
    await db.query<{ id: string }>(
      "select public.reserve_expense_receipt($1) id",
      [expense],
    )
  ).rows[0].id;
  const p = (
    await db.query<{ storage_path: string }>(
      "select storage_path from public.expense_receipts where id=$1",
      [id],
    )
  ).rows[0].storage_path;
  await db.query(
    'insert into storage.objects(bucket_id,name,metadata) values(\'3t-expense-receipts\',$1,\'{"size":100,"mimetype":"image/jpeg"}\')',
    [p],
  );
  await db.query("select public.finalize_receipt('3t-expense-receipts',$1)", [
    id,
  ]);
  await actor(c);
  expect(
    (await db.query("select * from storage.objects where name=$1", [p])).rows,
  ).toHaveLength(1);
  await expect(
    db.query("select public.reserve_expense_receipt($1)", [expense]),
  ).rejects.toThrow(/quyền/);
});
it("30-day expiry denies reads immediately and queues deletion without deleting history", async () => {
  await db.exec("reset role");
  await db.query(
    "update public.settlements set status='confirmed',confirmed_at=now()-interval '31 days' where id=$1",
    [payment],
  );
  await actor(b);
  expect(
    (await db.query("select * from storage.objects where name=$1", [path]))
      .rows,
  ).toHaveLength(0);
  await expect(
    db.query("select public.add_payment_evidence($1,'note',null,'Too late')", [
      payment,
    ]),
  ).rejects.toThrow();
  await db.exec("reset role");
  await db.exec("select public.expire_receipt_files()");
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.payment_evidence where id=$1",
        [evidence],
      )
    ).rows[0].status,
  ).toBe("expired");
  const jobs = (
    await db.query<{ id: string; lease_token: string }>(
      "select * from public.claim_storage_cleanup()",
    )
  ).rows;
  expect(jobs).toHaveLength(1);
  await db.query("select public.finish_storage_cleanup($1,$2,true)", [
    jobs[0].id,
    jobs[0].lease_token,
  ]);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.storage_cleanup_jobs where id=$1",
        [jobs[0].id],
      )
    ).rows[0].status,
  ).toBe("finished");
  expect(
    (
      await db.query("select * from public.payment_evidence where id=$1", [
        evidence,
      ])
    ).rows,
  ).toHaveLength(1);
});
