import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite,
  g: string,
  a: string,
  b: string,
  c: string,
  memberA: string,
  memberB: string;
async function actor(uid: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
  await db.exec("set role authenticated");
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to public;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;",
  );
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      readFileSync("supabase/migrations/" + file, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
  for (const uid of [a, b, c])
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [uid, uid + "@test.local"],
    );
  g = (
    await db.query<{ id: string }>(
      "select public.provision_group($1,'Polls','Sport') id",
      [a],
    )
  ).rows[0].id;
  memberA = (
    await db.query<{ id: string }>(
      "select id from public.group_members where group_id=$1 and user_id=$2",
      [g, a],
    )
  ).rows[0].id;
  memberB = (
    await db.query<{ id: string }>(
      "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'B') returning id",
      [g, b],
    )
  ).rows[0].id;
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function poll() {
  await actor(a);
  const start = new Date(Date.now() + 86400000).toISOString(),
    end = new Date(Date.now() + 90000000).toISOString();
  const id = (
    await db.query<{ id: string }>(
      "select public.create_poll($1,'Poll','Court',100,now()+interval '1 hour',$2) id",
      [g, [{ starts_at: start, ends_at: end }]],
    )
  ).rows[0].id;
  const option = (
    await db.query<{ id: string }>(
      "select id from public.poll_options where poll_id=$1",
      [id],
    )
  ).rows[0].id;
  return {
    id,
    option,
    body: {
      g,
      title_text: "Reviewed title",
      venue_text: "Reviewed court",
      start_time: start,
      ends_at: end,
      deadline: start,
      note: "Review",
      be_collector: false,
      nominee: "",
      invitees: [memberA, memberB],
    },
  };
}
async function schedule(
  p: Awaited<ReturnType<typeof poll>>,
  key = randomUUID(),
  patch: Record<string, unknown> = {},
) {
  return (
    await db.query<{ r: { id: string; replayed: boolean } }>(
      "select public.schedule_poll_meeting($1,$2,$3,$4) r",
      [key, p.id, p.option, { ...p.body, ...patch }],
    )
  ).rows[0].r;
}
it("ordinary members manually create with editable fields and no vote threshold; votes stay uncommitted", async () => {
  const p = await poll();
  await actor(b);
  const key = randomUUID(),
    first = await schedule(p, key);
  expect(first.replayed).toBe(false);
  expect((await schedule(p, key)).replayed).toBe(true);
  const result = (
    await db.query<{ title: string; venue: string }>(
      "select title,venue from public.sessions where id=$1",
      [first.id],
    )
  ).rows[0];
  expect(result).toEqual({ title: "Reviewed title", venue: "Reviewed court" });
  const attendees = (
    await db.query<{ rsvp: string; committed_at: null }>(
      "select rsvp,committed_at from public.session_attendees where session_id=$1",
      [first.id],
    )
  ).rows;
  expect(attendees).toHaveLength(2);
  expect(
    attendees.every((m) => m.rsvp === "none" && m.committed_at === null),
  ).toBe(true);
  expect(
    (
      await db.query<{ status: string; resulting_session_id: string }>(
        "select status,resulting_session_id from public.polls where id=$1",
        [p.id],
      )
    ).rows[0],
  ).toEqual({ status: "closed", resulting_session_id: first.id });
  await expect(schedule(p)).rejects.toThrow(/đã có buổi/);
  await expect(schedule(p, key, { title_text: "Different" })).rejects.toThrow(
    /nội dung/,
  );
});
it("closing only stops voting and never creates a session; creator or admin only", async () => {
  const p = await poll();
  await actor(b);
  await expect(
    db.query("select public.finish_poll($1)", [p.id]),
  ).rejects.toThrow(/Chỉ/);
  await actor(a);
  await db.query("select public.finish_poll($1)", [p.id]);
  await db.query("select public.finish_poll($1)", [p.id]);
  expect(
    (
      await db.query<{ resulting_session_id: null }>(
        "select resulting_session_id from public.polls where id=$1",
        [p.id],
      )
    ).rows[0].resulting_session_id,
  ).toBeNull();
  await expect(
    db.query("select public.vote_poll($1,'yes')", [p.option]),
  ).rejects.toThrow(/hết hạn/);
  await expect(
    db.query("select public.close_poll($1,$2)", [p.id, p.option]),
  ).rejects.toThrow(/form/);
  await actor(b);
  expect((await schedule(p)).id).toBeTruthy();
});
it("rejects cross-group option, cross-group target and outsider without leaving a partial session", async () => {
  const p = await poll(),
    q = await poll();
  await actor(c);
  await expect(schedule(p)).rejects.toThrow(/quyền/);
  await actor(b);
  const before = (
    await db.query<{ n: number }>(
      "select count(*)::int n from public.sessions where group_id=$1",
      [g],
    )
  ).rows[0].n;
  await expect(
    db.query("select public.schedule_poll_meeting($1,$2,$3,$4)", [
      randomUUID(),
      p.id,
      q.option,
      p.body,
    ]),
  ).rejects.toThrow(/Khung giờ/);
  await expect(schedule(p, randomUUID(), { g: randomUUID() })).rejects.toThrow(
    /quyền/,
  );
  await expect(
    schedule(p, randomUUID(), { invitees: [randomUUID()] }),
  ).rejects.toThrow();
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.sessions where group_id=$1",
        [g],
      )
    ).rows[0].n,
  ).toBe(before);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.polls where id=$1",
        [p.id],
      )
    ).rows[0].status,
  ).toBe("open");
});
it("rejects stale/past options and revoked membership, including a retry", async () => {
  const p = await poll();
  await db.exec("reset role");
  await db.query(
    "update public.poll_options set starts_at=now()-interval '1 hour',ends_at=now()+interval '1 hour' where id=$1",
    [p.option],
  );
  await actor(b);
  await expect(schedule(p)).rejects.toThrow(/đã qua/);
  const q = await poll();
  await actor(b);
  const key = randomUUID();
  await schedule(q, key);
  await db.exec("reset role");
  await db.query(
    "update public.group_members set status='removed' where id=$1",
    [memberB],
  );
  await actor(b);
  await expect(schedule(q, key)).rejects.toThrow(/quyền/);
});
