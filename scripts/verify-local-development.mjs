import { chromium, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { setRsvp } from "./ui-helpers.mjs";
import { cleanLocal } from "./clean-local.mjs";
import pg from "pg";
import {
  allowsLocalLogin,
  isLoopbackUrl,
} from "../src/lib/local-development-config.mjs";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(".tools/browsers"))
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".tools/browsers");
const local = parseEnv(readFileSync(".env.development.local", "utf8"));
const origin = local.NEXT_PUBLIC_APP_URL;
const dbUri = new URL(local.SUPABASE_DB_URL);
if (
  !allowsLocalLogin({
    nodeEnv: "development",
    flag: local.THREE_T_LOCAL_DEVELOPMENT,
    apiUrl: local.NEXT_PUBLIC_SUPABASE_URL,
    appUrl: origin,
  }) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(dbUri.hostname)
)
  throw Error("LOOPBACK_CONFIGURATION_REQUIRED");
let browser,
  step = "connect";
let createdSession;
const db = new pg.Client({
  connectionString: local.SUPABASE_DB_URL,
  connectionTimeoutMillis: 10000,
});
try {
  await db.connect();
  browser = await chromium.launch();
  const context = await browser.newContext();
  await context.route("**/*", (route) =>
    isLoopbackUrl(new URL(route.request().url()).origin, ["http:", "https:"])
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  step = "local-login";
  await page.goto(origin + "/login");
  await expect(
    page.getByRole("heading", {
      name: "Supabase local · Dữ liệu riêng",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tiếp tục với Google", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "An · Admin nhóm", exact: true })
    .click();
  await page.waitForURL(origin + "/");
  await expect(
    page.getByRole("link", { name: "Local · Đổi vai", exact: true }),
  ).toBeVisible();
  step = "seeded-calendar";
  await page.goto(origin + "/sessions");
  await expect(page.locator(".calendar")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Buổi chơi thử · Supabase local",
      exact: true,
    }),
  ).toBeVisible();
  step = "create-and-persist";
  await page.getByRole("link", { name: "Tạo buổi chơi", exact: true }).click();
  const groupId = "00000000-0000-4000-8000-000000003001";
  await page.getByLabel("Nhóm", { exact: true }).selectOption(groupId);
  const title = "Lịch kiểm tra local · " + randomUUID().slice(0, 6);
  await page.getByLabel("Tên buổi", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Mời cả nhóm", exact: true }).click();
  await page.getByRole("button", { name: "Tạo lịch", exact: true }).click();
  await page.waitForURL(/\/sessions\/[a-f0-9-]{36}$/);
  const sid = new URL(page.url()).pathname.split("/").at(-1);
  createdSession = sid;
  const saved = (
    await db.query("select title,group_id from public.sessions where id=$1", [
      sid,
    ])
  ).rows[0];
  if (saved?.title !== title || saved.group_id !== groupId)
    throw Error("LOCAL_SESSION_NOT_PERSISTED");
  await page.goto(origin + "/sessions");
  await expect(page.locator(`a[href="/sessions/${sid}"]`)).toBeVisible();
  await page.reload();
  await expect(page.locator(`a[href="/sessions/${sid}"]`)).toBeVisible();
  step = "ordinary-member-rsvp";
  await page
    .getByRole("link", { name: "Local · Đổi vai", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Bình · Thành viên", exact: true })
    .click();
  await page.waitForURL(origin + "/");
  await page.goto(origin + "/sessions/" + sid);
  await setRsvp(page);
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "select count(*)::int n from public.session_attendees a join public.group_members m on m.id=a.member_id join auth.users u on u.id=m.user_id where a.session_id=$1 and u.email='binh@local.3t.test' and a.rsvp='going' and a.committed_at is not null",
            [sid],
          )
        ).rows[0].n,
    )
    .toBe(1);
  step = "outsider-gate";
  await page
    .getByRole("link", { name: "Local · Đổi vai", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Khách · Chưa có nhóm", exact: true })
    .click();
  await page.waitForURL(origin + "/welcome");
  await page.goto(origin + "/sessions");
  await expect(page).toHaveURL(origin + "/welcome");
  console.log(
    JSON.stringify({
      passed: true,
      origin,
      localOnly: true,
      realLocalAuth: true,
      calendarVisible: true,
      meetingCreated: true,
      survivesReload: true,
      memberRsvp: true,
      outsiderDenied: true,
      hostedDatabaseTouched: false,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      passed: false,
      step,
      code: error.code || error.message?.slice(0, 700) || error.name,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await db.end().catch(() => {});
  if (createdSession && process.env.THREE_T_KEEP_TEST_DATA !== "1") {
    try {
      await cleanLocal({ apply: true, sessionIds: [createdSession] });
    } catch (error) {
      console.error(
        JSON.stringify({ cleanup: false, code: error.code || error.name }),
      );
      process.exitCode = 1;
    }
  }
}
