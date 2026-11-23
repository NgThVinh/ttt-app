import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import pg from "pg";
export function check(ok, code) {
  if (!ok) throw Object.assign(new Error(), { code });
}
export async function localBrowser(port, directory, options = {}) {
  const origin = `http://127.0.0.1:${port}`;
  const status = JSON.parse(
    execFileSync(
      process.execPath,
      [
        ".tools/supabase/node_modules/supabase/dist/supabase.js",
        "status",
        "--output",
        "json",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  check(
    [status.API_URL, status.DB_URL].every(
      (value) => new URL(value).hostname === "127.0.0.1",
    ),
    "LOCAL_STACK_REQUIRED",
  );
  try {
    await fetch(origin, { signal: AbortSignal.timeout(500) });
    throw Object.assign(new Error(), { code: "PORT_IN_USE" });
  } catch (e) {
    if (e.code === "PORT_IN_USE") throw e;
  }
  const pub = status.PUBLISHABLE_KEY || status.ANON_KEY;
  const admin = createClient(
    status.API_URL,
    status.SECRET_KEY || status.SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const db = new pg.Client({
    connectionString: status.DB_URL,
    connectionTimeoutMillis: 10000,
  });
  let server, browser, log;
  async function close() {
    await browser?.close();
    server?.kill();
    if (log !== undefined) closeSync(log);
    await db.end().catch(() => {});
  }
  try {
    await db.connect();
    mkdirSync(directory, { recursive: true });
    log = openSync(directory + "/server.log", "w");
    const env = {
      ...process.env,
      NEXT_PUBLIC_APP_URL: origin,
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: pub,
      SUPABASE_SECRET_KEY: status.SECRET_KEY || status.SERVICE_ROLE_KEY,
      AI_KILL_SWITCH: "1",
      GEMINI_API_KEY: "",
      OPENROUTER_API_KEY: "",
      SUPABASE_DB_URL: "",
    };
    delete env.NODE_TLS_REJECT_UNAUTHORIZED;
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        options.production ? "start" : "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      { env, windowsHide: true, stdio: ["ignore", log, log] },
    );
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (server.exitCode !== null) break;
      try {
        if (
          (
            await fetch(origin + "/login", {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    check(ready, "LOCAL_NEXT_NOT_READY");
    browser = await chromium.launch({ headless: true });
    async function login(email) {
      const users = await admin.auth.admin.listUsers();
      check(!users.error, "LOCAL_AUTH_LIST");
      let user = users.data.users.find((user) => user.email === email);
      if (!user) {
        const result = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
        });
        check(!result.error, "LOCAL_AUTH_CREATE");
        user = result.data.user;
      }
      const link = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      check(!link.error, "LOCAL_AUTH_LINK");
      const cookies = [];
      const client = createServerClient(status.API_URL, pub, {
        cookies: {
          getAll: () => cookies,
          setAll: (values) => {
            for (const cookie of values) {
              const old = cookies.findIndex((c) => c.name === cookie.name);
              if (old >= 0) cookies.splice(old, 1);
              cookies.push(cookie);
            }
          },
        },
      });
      check(
        !(
          await client.auth.verifyOtp({
            type: "magiclink",
            token_hash: link.data.properties.hashed_token,
          })
        ).error,
        "LOCAL_AUTH_VERIFY",
      );
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      await context.addCookies(
        cookies.map(({ name, value }) => ({ name, value, url: origin })),
      );
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      return { user, client, context, page };
    }
    return { origin, admin, db, login, close };
  } catch (error) {
    await close();
    throw error;
  }
}
