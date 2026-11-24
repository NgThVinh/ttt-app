import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(".tools/browsers"))
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".tools/browsers");
const origin = "http://127.0.0.1:3219";
let browser,
  server,
  log,
  step = "setup";
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
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
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
    cookies: {
      getAll: () => cookies,
      setAll: (values) => cookies.push(...values),
    },
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
  check(new URL(status.DB_URL).hostname === "127.0.0.1", "LOCAL_DB_REQUIRED");
  const fixtureDb = new pg.Client({ connectionString: status.DB_URL });
  const guestId = "55555555-1111-4555-8555-555555555556";
  await fixtureDb.connect();
  try {
    const {
      data: { user },
    } = await client.auth.getUser();
    const g = "55555555-1111-4555-8555-555555555555";
    await fixtureDb.query(
      "insert into public.groups(id,name,sport,created_by) values($1,'Profile UI fixture','Test',$2) on conflict(id) do nothing",
      [g, user.id],
    );
    await fixtureDb.query(
      "insert into public.group_members(group_id,user_id,display_name,role) values($1,$2,'UI fixture','admin') on conflict(group_id,user_id) do nothing",
      [g, user.id],
    );
    await fixtureDb.query(
      "insert into public.group_members(id,group_id,display_name) values($1,$2,'Khách UI') on conflict(id) do nothing",
      [guestId, g],
    );
    await fixtureDb.query(
      "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'UI fixture','000000','123456789','UI TEST') on conflict(id) do update set bank_bin='000000',bank_account_no='123456789',bank_account_name='UI TEST'",
      [user.id],
    );
  } finally {
    await fixtureDb.end();
  }
  mkdirSync(".tools/auth-ui", { recursive: true });
  log = openSync(".tools/auth-ui/server.log", "w");
  const env = {
    ...process.env,
    THREE_T_TEST_DIST_DIR: ".tools/auth-ui/next-build",
    THREE_T_LOCAL_DEVELOPMENT: "0",
    THREE_T_LOCAL_AUTH_PASSWORD: "",
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
  let catalogRequests = 0;
  await context.route("https://api.vietqr.io/**", (route) => {
    catalogRequests++;
    return route.abort();
  });
  await context.addCookies(
    cookies.map(({ name, value }) => ({ name, value, url: origin })),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/me");
  step = "unknown-bank";
  await page.getByRole("heading", { name: "Hồ sơ của tôi" }).waitFor();
  await page.getByLabel("Tên hiển thị", { exact: true }).fill("UI fixture");
  const bank = page.getByRole("combobox", { name: "Ngân hàng", exact: true });
  const save = page.getByRole("button", { name: "Lưu", exact: true });
  async function saveAndWait() {
    const done = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/me",
    );
    await save.click();
    await done;
    await expect(save).toBeEnabled();
    await page
      .getByRole("status")
      .filter({ hasText: "Đã lưu hồ sơ." })
      .waitFor();
  }
  await expect(bank).toHaveValue(/000000/);
  await saveAndWait();
  check(
    (await client.from("profiles").select("bank_bin").single()).data
      .bank_bin === "000000",
    "UNKNOWN_SAVED_BANK_PRESERVED",
  );
  step = "invalid-search";
  await bank.fill("ngan hang khong ton tai xyz");
  await expect(page.getByRole("listbox")).toContainText(
    "Không tìm thấy ngân hàng",
  );
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(bank).toHaveAttribute("aria-invalid", "true");
  check(
    (await client.from("profiles").select("bank_bin").single()).data
      .bank_bin === "000000",
    "FREE_TEXT_DOES_NOT_SAVE_WRONG_BANK",
  );
  step = "search-and-select";
  await bank.fill("ngoai thuong");
  await expect(page.locator(".bank-menu")).toHaveClass(/is-open/);
  await page.screenshot({
    path: ".tools/auth-ui/bank-search-390.png",
    animations: "disabled",
  });
  await page.getByRole("option", { name: /Vietcombank/ }).click();
  await expect(bank).toHaveValue("Vietcombank");
  await expect(page.locator('input[name="bank_bin"]')).toHaveValue("970436");
  await page.getByLabel("Số tài khoản", { exact: true }).fill("123456789");
  await page.getByLabel("Tên chủ tài khoản", { exact: true }).fill("UI TEST");
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
  step = "save-vcb-profile";
  await saveAndWait();
  await page.reload();
  await page.getByLabel("Tên hiển thị", { exact: true }).waitFor();
  await expect(bank).toHaveValue("Vietcombank");
  step = "keyboard-selection";
  await bank.fill("MB");
  await bank.press("Enter");
  await expect(bank).toHaveValue("MBBank");
  await expect(page.locator('input[name="bank_bin"]')).toHaveValue("970422");
  await bank.fill("TPB");
  await bank.press("Escape");
  await expect(bank).toHaveValue("MBBank");
  await bank.click();
  await expect(page.locator(".bank-menu")).toHaveClass(/is-open/);
  await bank.press("Escape");
  step = "save-mb-profile";
  await saveAndWait();
  await page.reload();
  await expect(bank).toHaveValue("MBBank");
  await bank.focus();
  await bank.press("Enter");
  await expect(page.locator('input[name="bank_bin"]')).toHaveValue("970422");
  check(
    (await client.from("profiles").select("bank_bin").single()).data
      .bank_bin === "970422",
    "SELECTED_BANK_BIN_PERSISTED",
  );
  check(
    (await page.getByLabel("Tên hiển thị", { exact: true }).inputValue()) ===
      "UI fixture",
    "PROFILE_NOT_PERSISTED",
  );
  step = "dark-mode";
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
      animations: "disabled",
      caret: "initial",
    });
  }
  step = "guest-bank";
  await page.goto(origin + "/groups/55555555-1111-4555-8555-555555555555");
  await page.getByText("Ngân hàng của Khách UI", { exact: true }).click();
  const guestForm = page
    .locator("details")
    .filter({ has: page.getByText("Ngân hàng của Khách UI", { exact: true }) });
  await guestForm
    .getByRole("combobox", { name: "Ngân hàng", exact: true })
    .fill("TCB");
  await page.getByRole("option", { name: "Techcombank", exact: true }).click();
  await guestForm.getByLabel("Số tài khoản", { exact: true }).fill("123456780");
  await guestForm
    .getByLabel("Tên chủ tài khoản", { exact: true })
    .fill("GUEST TEST");
  await guestForm
    .getByLabel("Lý do nhập hoặc sửa", { exact: true })
    .fill("Kiểm thử chọn ngân hàng");
  await guestForm
    .getByRole("button", {
      name: "Lưu ngân hàng thành viên khách",
      exact: true,
    })
    .click();
  await expect(guestForm.getByRole("status")).toContainText(
    "Đã lưu ngân hàng thành viên khách",
  );
  check(
    (
      await client
        .from("guest_bank_accounts")
        .select("bank_bin")
        .eq("member_id", guestId)
        .single()
    ).data.bank_bin === "970407",
    "GUEST_BANK_BIN_PERSISTED",
  );
  step = "bank-touch";
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  await touch.addCookies(await context.cookies());
  const touchPage = await touch.newPage();
  await touchPage.goto(origin + "/me");
  const touchBank = touchPage.getByRole("combobox", {
    name: "Ngân hàng",
    exact: true,
  });
  await touchBank.tap();
  await expect(touchPage.locator(".bank-menu")).toHaveClass(/is-open/);
  const menuBounds = await touchPage.locator(".bank-menu").boundingBox();
  check(
    menuBounds.x >= 0 &&
      menuBounds.y >= 0 &&
      menuBounds.x + menuBounds.width <= 390 &&
      menuBounds.y + menuBounds.height <= 844,
    "BANK_POPUP_INSIDE_VIEWPORT",
  );
  await touchPage
    .getByRole("option", { name: "Vietcombank", exact: true })
    .tap();
  await expect(touchBank).toHaveValue("Vietcombank");
  await expect(touchPage.locator('input[name="bank_bin"]')).toHaveValue(
    "970436",
  );
  await touchPage.emulateMedia({ reducedMotion: "reduce" });
  await touchBank.tap();
  check(
    await touchPage.locator(".bank-menu").evaluate((el) =>
      getComputedStyle(el)
        .transitionDuration.split(",")
        .every((value) => parseFloat(value) === 0),
    ),
    "BANK_PICKER_REDUCED_MOTION",
  );
  await touch.close();
  await page.goto(origin + "/me");
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
      bankSearchAndKeyboard: true,
      guestBankPicker: true,
      touchBankPicker: true,
      unknownBankPreserved: true,
      catalogRequests,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      code: error.code || error.name,
      step,
      detail: error.message?.slice(0, 1000),
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
  if (log !== undefined) closeSync(log);
}
