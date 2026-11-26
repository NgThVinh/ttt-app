import pg from "pg";
import { readFileSync } from "node:fs";
import { databaseUrlForProject } from "./migration-utils.mjs";

delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
let db;
try {
  db = new pg.Client({
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
  await db.connect();
  const r = (
    await db.query(`select
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='sessions' and column_name='ends_at') as session_end_time,
    has_function_privilege('authenticated','public.invite_details(text)','EXECUTE') as invitation,
    has_function_privilege('authenticated','public.accept_invite_with_claim(text,text,uuid)','EXECUTE') as join_group,
    has_function_privilege('authenticated','public.schedule_calendar_meeting(uuid,jsonb,uuid,uuid)','EXECUTE') as scheduling,
    has_function_privilege('authenticated','public.my_debt_summary()','EXECUTE') as dashboard,
    not exists(select 1 from pg_tables where schemaname='public' and not rowsecurity) as rls`)
  ).rows[0];
  if (!Object.values(r).every((v) => v === true))
    throw Object.assign(new Error(), {
      code: "DEPLOYMENT_SCHEMA_INCOMPATIBLE",
    });
  console.log(JSON.stringify({ schemaReady: true, readOnly: true }));
} catch (error) {
  console.error(JSON.stringify({ code: error.code || "SCHEMA_CHECK_FAILED" }));
  process.exitCode = 1;
} finally {
  await db?.end().catch(() => {});
}
