import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { databaseUrlForProject } from "./migration-utils.mjs";

// Existing dedicated QA identities only; all business fixtures are rolled back.
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
if (!process.argv.includes("--rollback-fixtures"))
  throw Error("EXPLICIT_ROLLBACK_FIXTURES_FLAG_REQUIRED");
const db = new pg.Client({
  connectionString: databaseUrlForProject(
    process.env.SUPABASE_DB_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  ssl: {
    ca: readFileSync("supabase/certs/prod-ca-2021.crt", "utf8"),
    rejectUnauthorized: true,
  },
  connectionTimeoutMillis: 15000,
  query_timeout: 15000,
});
let transaction = false,
  stage = "connect";
const passed = [];
function check(value, code) {
  if (!value) throw Object.assign(new Error(), { code });
  passed.push(code);
}
async function actor(id) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
  await db.query("set local role authenticated");
}
try {
  await db.connect();
  const users = (
    await db.query(
      "select id from auth.users where email like '3t-qa-%@example.invalid' and email_confirmed_at is not null order by created_at limit 2",
    )
  ).rows;
  check(users.length === 2, "EXISTING_VERIFIED_QA_IDENTITIES");
  const [owner, newcomer] = users.map((u) => u.id);
  await db.query("begin");
  transaction = true;
  await db.query("set local lock_timeout='3s'");
  stage = "schema";
  const schema = (
    await db.query(
      "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='sessions' and column_name='ends_at') as ends_at, has_function_privilege('authenticated','public.invite_details(text)','EXECUTE') as invitation, has_function_privilege('authenticated','public.accept_invite_with_claim(text,text,uuid)','EXECUTE') as join_group, has_function_privilege('authenticated','public.schedule_calendar_meeting(uuid,jsonb,uuid,uuid)','EXECUTE') as calendar",
    )
  ).rows[0];
  check(
    Object.values(schema).every(Boolean),
    "SCHEMA_AND_AUTHENTICATED_GRANTS",
  );
  stage = "isolated-group";
  const group = (
    await db.query(
      "select public.provision_group($1,'Rollback release verification','Sport') id",
      [owner],
    )
  ).rows[0].id;
  await actor(owner);
  const hash = createHash("sha256").update(randomBytes(32)).digest("hex");
  await db.query(
    "select public.create_invite($1,$2,now()+interval '1 hour',1)",
    [group, hash],
  );
  await actor(newcomer);
  check(
    !(await db.query("select public.is_member($1) ok", [group])).rows[0].ok,
    "NEWCOMER_STARTS_OUTSIDE_GROUP",
  );
  stage = "invitation";
  const invitation = (
    await db.query("select public.invite_details($1) data", [hash])
  ).rows[0].data;
  check(invitation.group_id === group, "NEWCOMER_OPENS_INVITATION");
  const joined = (
    await db.query(
      "select public.accept_invite_with_claim($1,'QA member',null) id",
      [hash],
    )
  ).rows[0].id;
  check(joined === group, "NEWCOMER_JOINS_GROUP");
  check(
    (
      await db.query(
        "select public.accept_invite_with_claim($1,'QA member',null) id",
        [hash],
      )
    ).rows[0].id === group,
    "JOIN_RETRY_AFTER_LAST_USE",
  );
  const members = (
    await db.query(
      "select id,user_id from public.group_members where group_id=$1 and status='active'",
      [group],
    )
  ).rows;
  check(members.length === 2, "JOIN_VISIBLE_THROUGH_RLS");
  stage = "create-session";
  const starts = new Date(Date.now() + 2 * 86400000);
  const body = {
    g: group,
    title_text: "Rollback release verification",
    venue_text: "QA Court",
    start_time: starts.toISOString(),
    ends_at: new Date(+starts + 7200000).toISOString(),
    deadline: starts.toISOString(),
    note: "",
    be_collector: false,
    nominee: "",
    invitees: members.map((m) => m.id),
    repeat_weeks: 0,
  };
  for (const [id, label] of [
    [owner, "ADMIN"],
    [newcomer, "MEMBER"],
  ]) {
    await actor(id);
    const key = randomUUID();
    const result = (
      await db.query(
        "select public.schedule_calendar_meeting($1,$2::jsonb,null,null) data",
        [key, JSON.stringify(body)],
      )
    ).rows[0].data;
    check(typeof result.id === "string", label + "_CREATES_SESSION");
    const session = (
      await db.query("select id,ends_at from public.sessions where id=$1", [
        result.id,
      ])
    ).rows[0];
    check(
      session?.ends_at &&
        new Date(session.ends_at).toISOString() === body.ends_at,
      label + "_READS_SESSION_END_TIME",
    );
    check(
      (
        await db.query(
          "select count(*)::int n from public.session_attendees where session_id=$1",
          [result.id],
        )
      ).rows[0].n === 2,
      label + "_INVITES_GROUP_MEMBERS",
    );
    const retry = (
      await db.query(
        "select public.schedule_calendar_meeting($1,$2::jsonb,null,null) data",
        [key, JSON.stringify(body)],
      )
    ).rows[0].data;
    check(
      retry.id === result.id && retry.replayed === true,
      label + "_CREATE_RETRY_IS_IDEMPOTENT",
    );
  }
  await db.query("rollback");
  transaction = false;
  check(
    !(
      await db.query(
        "select exists(select 1 from public.groups where id=$1) present",
        [group],
      )
    ).rows[0].present,
    "ALL_FIXTURES_ROLLED_BACK",
  );
  console.log(
    JSON.stringify({
      passed,
      committed: false,
      createdAuthUsers: 0,
      exportedProductionData: false,
    }),
  );
} catch (error) {
  if (transaction) await db.query("rollback").catch(() => {});
  console.error(
    JSON.stringify({
      stage,
      code: error.code || error.name,
      rolledBack: transaction,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
