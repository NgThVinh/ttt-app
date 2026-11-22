import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
const origin = "http://127.0.0.1:3219";
let browser, server, log;
function check(ok, code) {
  if (!ok) throw Object.assign(new Error(), { code });
}
try {
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
    new URL(status.API_URL).hostname === "127.0.0.1",
    "LOCAL_SUPABASE_REQUIRED",
  );
  try {
    await fetch(origin, { signal: AbortSignal.timeout(500) });
    throw Object.assign(new Error(), { code: "LOCAL_PORT_IN_USE" });
  } catch (e) {
    if (e.code === "LOCAL_PORT_IN_USE") throw e;
  }
  const secret = status.SECRET_KEY || status.SERVICE_ROLE_KEY,
    pub = status.PUBLISHABLE_KEY || status.ANON_KEY;
  const admin = createClient(status.API_URL, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = "ui-acceptance@3t.test";
  const list = await admin.auth.admin.listUsers();
  check(!list.error, "LIST_USERS_FAILED");
  if (!list.data.users.some((user) => user.email === email))
    check(
      !(await admin.auth.admin.createUser({ email, email_confirm: true }))
        .error,
      "CREATE_LOCAL_USER_FAILED",
    );
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  check(!link.error, "LOCAL_AUTH_LINK_FAILED");
  const cookies = [];
  const client = createServerClient(status.API_URL, pub, {
    cookies: { getAll: () => [], setAll: (values) => cookies.push(...values) },
  });
  check(
    !(
      await client.auth.verifyOtp({
        type: "magiclink",
        token_hash: link.data.properties.hashed_token,
      })
    ).error,
    "LOCAL_AUTH_FAILED",
  );
  mkdirSync(".tools/auth-ui", { recursive: true });
  log = openSync(".tools/auth-ui/server.log", "w");
  const env = {
    ...process.env,
    NEXT_PUBLIC_APP_URL: origin,
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: pub,
    SUPABASE_SECRET_KEY: secret,
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
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3219",
    ],
    { env, windowsHide: true, stdio: ["ignore", log, log] },
  );
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) break;
    try {
      if (
        (await fetch(origin + "/login", { signal: AbortSignal.timeout(1000) }))
          .ok
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  check(ready, "LOCAL_SERVER_NOT_READY");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addCookies(
    cookies.map(({ name, value }) => ({ name, value, url: origin })),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/me");
  await page.getByRole("heading", { name: "Hồ sơ của tôi" }).waitFor();
  await page.getByLabel("Tên hiển thị", { exact: true }).fill("UI fixture");
  await page
    .getByLabel("Mã BIN ngân hàng (6 số)", { exact: true })
    .fill("970436");
  await page.getByLabel("Số tài khoản", { exact: true }).fill("123456789");
  await page.getByLabel("Tên chủ tài khoản", { exact: true }).fill("UI TEST");
  const save = page.getByRole("button", { name: "Lưu", exact: true });
  check(
    await save.evaluate((el) => el.getBoundingClientRect().height >= 44),
    "TOUCH_TARGET_TOO_SMALL",
  );
  check(
    await save.evaluate(
      (el) => getComputedStyle(el).color === "rgb(255, 255, 255)",
    ),
    "PRIMARY_TEXT_CONTRAST",
  );
  await save.click();
  await page.getByRole("status").filter({ hasText: "Đã lưu hồ sơ." }).waitFor();
  await page.reload();
  await page.getByLabel("Tên hiển thị", { exact: true }).waitFor();
  check(
    (await page.getByLabel("Tên hiển thị", { exact: true }).inputValue()) ===
      "UI fixture",
    "PROFILE_NOT_PERSISTED",
  );
  await page.getByRole("button", { name: "Bật giao diện tối" }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "PROFILE_OVERFLOW_" + width,
    );
    await page.screenshot({
      path: `.tools/auth-ui/profile-${width}.png`,
      fullPage: true,
      caret: "initial",
    });
  }
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.waitForURL(/\/login$/);
  await page.goto(origin + "/me");
  await page.waitForURL(/\/login$/);
  check(errors.length === 0, "BROWSER_RUNTIME_ERROR");
  console.log(
    JSON.stringify({
      passed: true,
      localOnly: true,
      providerCalls: 0,
      profileSaved: true,
      touchTarget44: true,
      darkMode: true,
      responsive: [320, 390, 1440],
      logoutAndPrivateRouteDenied: true,
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ code: error.code || error.name }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
  if (log !== undefined) closeSync(log);
}
