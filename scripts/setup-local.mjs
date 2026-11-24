import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  localAccounts,
  isLoopbackUrl,
} from "../src/lib/local-development-config.mjs";

const cli = fileURLToPath(
  new URL(
    "../.tools/supabase/node_modules/supabase/dist/supabase.js",
    import.meta.url,
  ),
);
const envFile = fileURLToPath(
  new URL("../.env.development.local", import.meta.url),
);
const groupId = "00000000-0000-4000-8000-000000003001";
function requireLocal(condition, code) {
  if (!condition) throw Object.assign(new Error(), { code });
}
function supabase(args) {
  try {
    return execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180000,
    });
  } catch {
    throw Object.assign(new Error(), { code: "LOCAL_SUPABASE_COMMAND_FAILED" });
  }
}
export async function setupLocal() {
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  requireLocal(existsSync(cli), "LOCAL_SUPABASE_CLI_MISSING");
  // All command output is captured: the CLI status/start JSON contains keys.
  try {
    supabase(["status", "--output", "json"]);
  } catch {
    supabase(["start", "--output", "json"]);
  }
  const status = JSON.parse(supabase(["status", "--output", "json"]));
  const dbUrl = new URL(status.DB_URL);
  requireLocal(
    isLoopbackUrl(status.API_URL) &&
      ["postgres:", "postgresql:"].includes(dbUrl.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(dbUrl.hostname) &&
      dbUrl.pathname === "/postgres",
    "LOOPBACK_STACK_REQUIRED",
  );
  supabase(["migration", "up", "--local"]);
  const previous = existsSync(envFile)
    ? parseEnv(readFileSync(envFile, "utf8"))
    : {};
  const password =
    previous.THREE_T_LOCAL_AUTH_PASSWORD ||
    randomBytes(32).toString("base64url");
  const publishable = status.PUBLISHABLE_KEY || status.ANON_KEY;
  const secret = status.SECRET_KEY || status.SERVICE_ROLE_KEY;
  requireLocal(!!publishable && !!secret, "LOCAL_STACK_KEYS_MISSING");
  const auth = createClient(status.API_URL, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const existing = await auth.auth.admin.listUsers({ page: 1, perPage: 1000 });
  requireLocal(!existing.error, "LOCAL_AUTH_LIST_FAILED");
  const users = [];
  for (const account of localAccounts) {
    const old = existing.data.users.find((u) => u.email === account.email);
    const response = old
      ? await auth.auth.admin.updateUserById(old.id, {
          password,
          email_confirm: true,
        })
      : await auth.auth.admin.createUser({
          email: account.email,
          password,
          email_confirm: true,
          user_metadata: { full_name: account.name },
        });
    requireLocal(
      !response.error && !!response.data.user,
      "LOCAL_AUTH_SEED_FAILED",
    );
    users.push({ ...account, userId: response.data.user.id });
  }
  const db = new pg.Client({
    connectionString: status.DB_URL,
    connectionTimeoutMillis: 10000,
  });
  let transaction = false;
  try {
    await db.connect();
    await db.query("begin");
    transaction = true;
    await db.query(
      "insert into public.groups(id,name,sport,created_by) values($1,'Nhóm chơi thử · Local','Cầu lông',$2) on conflict(id) do nothing",
      [groupId, users[0].userId],
    );
    for (const account of users) {
      await db.query(
        "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,$2,'970436','LOCAL0001','DU LIEU THU LOCAL') on conflict(id) do nothing",
        [account.userId, account.name],
      );
      if (account.id !== "guest")
        await db.query(
          "insert into public.group_members(group_id,user_id,display_name,role) values($1,$2,$3,$4) on conflict(group_id,user_id) do nothing",
          [
            groupId,
            account.userId,
            account.name,
            account.id === "an" ? "admin" : "member",
          ],
        );
    }
    await db.query(
      "insert into app_private.super_admin_allowlist(email,active) values($1,true) on conflict(email) do update set active=true",
      [users[0].email],
    );
    await db.query("commit");
    transaction = false;
    const existingMeeting = await db.query(
      "select id from public.sessions where group_id=$1 and title='Buổi chơi thử · Supabase local' limit 1",
      [groupId],
    );
    if (!existingMeeting.rowCount) {
      const client = createClient(status.API_URL, publishable, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      requireLocal(
        !(
          await client.auth.signInWithPassword({
            email: users[0].email,
            password,
          })
        ).error,
        "LOCAL_SEED_LOGIN_FAILED",
      );
      const day = new Date(Date.now() + 86400000 + 7 * 3600000)
        .toISOString()
        .slice(0, 10);
      const people = (
        await db.query(
          "select id from public.group_members where group_id=$1 and status='active'",
          [groupId],
        )
      ).rows.map((r) => r.id);
      const meeting = await client.rpc("schedule_meeting", {
        request_key: "00000000-0000-4000-8000-000000003002",
        body: {
          g: groupId,
          title_text: "Buổi chơi thử · Supabase local",
          venue_text: "Sân thử nghiệm",
          start_time: day + "T18:00:00+07:00",
          ends_at: day + "T20:00:00+07:00",
          deadline: day + "T18:00:00+07:00",
          be_collector: false,
          nominee: "",
          note: "Dữ liệu thử trên máy. Mỗi người tự nhận lời; chưa chốt chi phí.",
          invitees: people,
        },
      });
      requireLocal(!meeting.error, "LOCAL_MEETING_SEED_FAILED");
    }
  } finally {
    if (transaction) await db.query("rollback").catch(() => {});
    await db.end();
  }
  const overrides = {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
    SUPABASE_SECRET_KEY: secret,
    SUPABASE_DB_URL: status.DB_URL,
    SUPER_ADMIN_EMAILS: users[0].email,
    THREE_T_LOCAL_DEVELOPMENT: "1",
    THREE_T_LOCAL_AUTH_PASSWORD: password,
    AI_KILL_SWITCH: "1",
    AI_KEY_ENCRYPTION_SECRET:
      previous.AI_KEY_ENCRYPTION_SECRET ||
      randomBytes(32).toString("base64url"),
    CRON_SECRET: previous.CRON_SECRET || randomBytes(32).toString("base64url"),
    GEMINI_API_KEY: "",
    OPENROUTER_API_KEY: "",
    GROQ_API_KEY: "",
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
  };
  const values = { ...previous, ...overrides };
  writeFileSync(
    envFile,
    "# Supabase riêng cho next dev. Sinh bởi npm run local:setup. Không commit.\n" +
      Object.entries(values)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join("\n") +
      "\n",
  );
  console.log(
    JSON.stringify({
      localOnly: true,
      appUrl: overrides.NEXT_PUBLIC_APP_URL,
      supabaseUrl: status.API_URL,
      accounts: users.map((u) => u.label),
      group: "Nhóm chơi thử · Local",
      hostedDatabaseTouched: false,
    }),
  );
  return overrides;
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  setupLocal().catch((error) => {
    console.error(
      JSON.stringify({
        code: error.code || error.name,
        hint: "Mở Docker Desktop rồi chạy lại npm run local:setup. Không có thay đổi trên Supabase hosted.",
      }),
    );
    process.exitCode = 1;
  });
}
