import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { databaseUrlForProject } from "./migration-utils.mjs";
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
const origin = "https://thichtinhtien.online",
  directory = ".tools/production-journey";
const report = {
  at: new Date().toISOString(),
  origin,
  steps: [],
  limitations: [
    "Google consent is not automated: dedicated Auth test sessions are provisioned without email.",
    "Only test accounts/group and fake bank details; no real money transfer.",
    "Initial group/admin provisioned as test setup; all subsequent product actions use the UI.",
  ],
  errors: [],
  fixtures: {},
};
let browser,
  db,
  activePage,
  step = "setup";
function check(ok, code) {
  if (!ok) throw Object.assign(new Error(), { code });
}
function passed(name, extra = {}) {
  report.steps.push({ name, passed: true, ...extra });
  console.log(JSON.stringify({ passed: name, ...extra }));
}
async function screenshot(name) {
  await activePage.screenshot({
    path: `${directory}/${name}.png`,
    fullPage: true,
    caret: "initial",
  });
}
try {
  check(
    process.argv.includes("--write-test-fixtures"),
    "EXPLICIT_FIXTURE_FLAG_REQUIRED",
  );
  check(
    process.env.NEXT_PUBLIC_SUPABASE_URL ===
      "https://ubkfdlxrtsnuxjezopht.supabase.co",
    "EXPECTED_PROJECT_REQUIRED",
  );
  mkdirSync(directory, { recursive: true });
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  browser = await chromium.launch({ headless: true });
  const run = randomUUID().slice(0, 8);
  async function actor(role) {
    const email = `3t-qa-${run}-${role}@example.invalid`;
    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        full_name: role === "owner" ? "TEST Người thu" : "TEST Người chơi",
      },
    });
    check(!created.error, "TEST_AUTH_CREATE_FAILED");
    const link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    check(!link.error, "TEST_AUTH_LINK_FAILED");
    const cookies = [];
    const client = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        cookies: {
          getAll: () => cookies,
          setAll: (values) => cookies.push(...values),
        },
      },
    );
    check(
      !(
        await client.auth.verifyOtp({
          type: "magiclink",
          token_hash: link.data.properties.hashed_token,
        })
      ).error,
      "TEST_AUTH_VERIFY_FAILED",
    );
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await context.addCookies(
      cookies.map(({ name, value }) => ({ name, value, url: origin })),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) =>
      report.errors.push({
        page: new URL(page.url()).pathname,
        message: error.message,
      }),
    );
    return { user: created.data.user, page, context };
  }
  const owner = await actor("owner"),
    member = await actor("member");
  report.fixtures.users = [owner.user.id, member.user.id];
  activePage = member.page;
  step = "waiting";
  await activePage.goto(origin);
  await activePage.waitForURL(origin + "/welcome");
  await activePage
    .getByRole("heading", { name: "Chờ lời mời từ nhóm bạn", exact: true })
    .waitFor();
  check(
    (await activePage.getByRole("navigation").count()) === 0,
    "WAITING_HAS_NO_FEATURE_MENU",
  );
  await screenshot("01-waiting");
  passed("new account sees invitation-only page");
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
  });
  await db.connect();
  const group = randomUUID(),
    groupName = `[TEST] Trải nghiệm domain ${run}`;
  report.fixtures.group = group;
  await db.query("begin");
  try {
    await db.query(
      "insert into public.groups(id,name,sport,created_by) values($1,$2,'Kiểm thử',$3)",
      [group, groupName, owner.user.id],
    );
    await db.query(
      "insert into public.group_members(group_id,user_id,display_name,role) values($1,$2,'TEST Người thu','admin')",
      [group, owner.user.id],
    );
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
  activePage = owner.page;
  step = "invite";
  await activePage.goto(origin + "/groups/" + group);
  await activePage
    .getByRole("heading", { name: groupName, exact: true })
    .waitFor();
  await screenshot("02-group-admin");
  await activePage.getByText("Tùy chỉnh link mời", { exact: true }).click();
  await activePage.getByLabel("Số lượt dùng", { exact: true }).fill("1");
  await activePage
    .getByRole("button", { name: "Tạo link mời", exact: true })
    .click();
  const invite = activePage.locator(
    'a[href^="https://thichtinhtien.online/join/"]',
  );
  await invite.waitFor();
  const href = await invite.getAttribute("href");
  passed("admin creates invitation in product UI");
  activePage = member.page;
  await activePage.goto(href);
  await activePage
    .getByLabel("Tên trong nhóm", { exact: true })
    .fill("TEST Người chơi");
  await activePage
    .getByRole("button", { name: "Tham gia nhóm", exact: true })
    .click();
  await activePage.waitForURL(origin + "/groups/" + group);
  passed("member joins using invitation link");
  await activePage.goto(origin);
  await activePage.getByRole("heading", { name: /Chào / }).waitFor();
  await screenshot("03-member-home");
  activePage = owner.page;
  step = "profile";
  await activePage.goto(origin + "/me");
  await activePage
    .getByLabel("Tên hiển thị", { exact: true })
    .fill("TEST Người thu");
  await activePage
    .getByLabel("Mã BIN ngân hàng (6 số)", { exact: true })
    .fill("970436");
  await activePage
    .getByLabel("Số tài khoản", { exact: true })
    .fill("3TTEST0001");
  await activePage
    .getByLabel("Tên chủ tài khoản", { exact: true })
    .fill("TEST KHONG CHUYEN TIEN");
  await activePage.getByRole("button", { name: "Lưu", exact: true }).click();
  await activePage
    .getByRole("status")
    .filter({ hasText: "Đã lưu hồ sơ" })
    .waitFor();
  passed("collector sets up test receiving profile");
  step = "create-session";
  await activePage.goto(origin + "/sessions/new");
  await activePage.getByLabel("Tên buổi", { exact: true }).waitFor();
  const at = Date.now();
  await activePage
    .getByLabel("Tên buổi", { exact: true })
    .fill("[TEST] Cầu lông — không chuyển tiền thật");
  await activePage.getByLabel("Địa điểm", { exact: true }).fill("Sân kiểm thử");
  await activePage.getByLabel("Tiền sân (đ)", { exact: true }).fill("100000");
  await activePage
    .getByRole("button", { name: "Chọn tất cả", exact: true })
    .click();
  await screenshot("04-create-preview");
  await activePage
    .getByRole("button", { name: "Tôi đã xem bảng chia", exact: true })
    .click();
  await activePage
    .getByRole("button", { name: "Lưu buổi chơi", exact: true })
    .click();
  await activePage.waitForURL(/\/sessions\/[a-f0-9-]{36}$/);
  const sid = new URL(activePage.url()).pathname.split("/").pop();
  report.fixtures.session = sid;
  await activePage
    .getByRole("heading", {
      name: "[TEST] Cầu lông — không chuyển tiền thật",
      exact: true,
    })
    .waitFor();
  passed("create played session from UI", {
    automatedInputMs: Date.now() - at,
  });
  await screenshot("05-session-collector");
  activePage = member.page;
  step = "debts";
  await activePage.goto(origin + "/debts");
  await activePage
    .getByRole("heading", { name: "Công nợ của tôi", exact: true })
    .waitFor();
  check(
    (await activePage.locator("main").innerText()).includes("50.000đ"),
    "DEBT_MUST_BE_50000",
  );
  await screenshot("06-debts");
  passed("member sees 50000 VND debt");
  await activePage.goto(origin + "/sessions/" + sid);
  const panel = activePage
    .locator("article.session-row")
    .filter({ hasText: "Mã tham chiếu:" });
  await panel
    .getByRole("button", { name: "Tôi đã chuyển", exact: true })
    .click();
  await panel
    .getByText("Người chuyển đã báo chuyển, chờ xác nhận", { exact: true })
    .waitFor();
  await screenshot("07-reported-payment");
  passed("sender reports simulated payment; waits for receiver");
  activePage = owner.page;
  step = "confirm";
  await activePage.reload();
  const received = activePage
    .locator("article.session-row")
    .filter({ hasText: "Mã tham chiếu:" });
  await received.getByRole("button", { name: "Đã nhận", exact: true }).click();
  await received
    .locator("p")
    .filter({ hasText: /^Đã nhận$/ })
    .waitFor();
  await screenshot("08-confirmed");
  passed("receiver manually confirms simulated payment");
  activePage = member.page;
  await activePage.goto(origin + "/debts");
  await activePage
    .getByRole("heading", { name: "Công nợ của tôi", exact: true })
    .waitFor();
  check(
    (await activePage.locator("main").innerText()).includes("Tôi cần trả: 0đ"),
    "DEBT_CLEARED",
  );
  passed("debt returns to zero after confirmation");
  step = "review";
  for (const [path, name] of [
    ["/", "home"],
    ["/groups/" + group, "group"],
    ["/sessions/" + sid, "session"],
    ["/me", "profile"],
    ["/notifications", "notifications"],
    ["/ai", "ai"],
  ]) {
    await activePage.goto(origin + path);
    await activePage.locator("main h1").first().waitFor();
    for (const width of [390, 1440]) {
      await activePage.setViewportSize({ width, height: 900 });
      check(
        await activePage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "OVERFLOW_" + name,
      );
      await screenshot(`09-${name}-${width}`);
    }
  }
  passed("six product screens render without horizontal overflow");
  report.passed = report.errors.length === 0;
} catch (error) {
  report.passed = false;
  report.failure = { step, code: error.code || error.name };
  if (activePage) await screenshot("failure").catch(() => {});
  console.error(JSON.stringify(report.failure));
  process.exitCode = 1;
} finally {
  mkdirSync(directory, { recursive: true });
  writeFileSync(directory + "/report.json", JSON.stringify(report, null, 2));
  await browser?.close();
  await db?.end();
  console.log(
    JSON.stringify({
      report: directory + "/report.json",
      passed: report.passed,
      steps: report.steps.length,
    }),
  );
}
