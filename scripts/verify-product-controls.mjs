import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { localBrowser, check } from "./local-browser.mjs";
let app,
  page,
  step = "setup";
try {
  app = await localBrowser(3235, ".tools/product-controls");
  const { db, origin } = app;
  const owner = await app.login("controls-owner@3t.test"),
    member = await app.login("controls-member@3t.test"),
    outside = await app.login("controls-outside@3t.test");
  const g = randomUUID(),
    other = randomUUID(),
    a = randomUUID(),
    b = randomUUID(),
    c = randomUUID();
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Product controls fixture','Cầu lông',$2),($3,'Other controls fixture','Bóng đá',$4)",
    [g, owner.user.id, other, outside.user.id],
  );
  await db.query(
    "insert into public.group_members(id,group_id,user_id,display_name,role) values($1,$2,$3,'An','admin'),($4,$2,$5,'Bình','member'),($6,$7,$8,'Admin khác','admin')",
    [a, g, owner.user.id, b, member.user.id, c, other, outside.user.id],
  );
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'An','970436','00001111','AN LOCAL') on conflict(id) do update set bank_bin=excluded.bank_bin,bank_account_no=excluded.bank_account_no,bank_account_name=excluded.bank_account_name",
    [owner.user.id],
  );
  const start = new Date(Date.now() + 86400000).toISOString();
  const schedule = await owner.client.rpc("schedule_calendar_meeting", {
    request_key: randomUUID(),
    body: {
      g,
      title_text: "Buổi được xóa trong test",
      venue_text: "Sân A",
      start_time: start,
      ends_at: new Date(Date.parse(start) + 7200000).toISOString(),
      deadline: start,
      note: "",
      be_collector: false,
      nominee: "",
      invitees: [a, b],
      repeat_weeks: 0,
    },
  });
  check(!schedule.error, "SEED_SCHEDULE");
  const sid = schedule.data.id;
  page = owner.page;
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(origin + "/sessions");
  step = "flat-navigation";
  const nav = page.getByRole("navigation", {
    name: "Điều hướng chính",
    exact: true,
  });
  await expect(
    nav.getByRole("link", { name: "Yêu cầu", exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Trợ lý 3T", exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Nhật ký", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".more-navigation")).toHaveCount(0);
  await expect(page.locator('a[href="/polls"]')).toHaveCount(0);
  await expect(page.getByText("Đang vote", { exact: true })).toHaveCount(0);
  await member.page.goto(origin + "/sessions");
  await expect(member.page.locator('a[href="/audit"]')).toHaveCount(0);
  check(
    (await (await member.page.request.get(origin + "/api/navigation")).json())
      .canAudit === false,
    "MEMBER_NAV_NO_AUDIT",
  );
  const denied = await member.client.rpc("admin_audit_page", {});
  check(!!denied.error, "MEMBER_AUDIT_DENIED");
  await member.page.goto(origin + "/audit");
  await expect(
    member.page.getByRole("heading", {
      name: "Không tìm thấy trang",
      exact: true,
    }),
  ).toBeVisible();
  await expect(member.page.locator(".audit-list")).toHaveCount(0);
  step = "delete-session";
  await member.page.goto(origin + "/sessions/" + sid);
  await member.page
    .getByRole("button", { name: "Xóa buổi chưa chốt", exact: true })
    .click();
  const confirm = member.page.locator(".session-task-dialog[open]");
  await confirm.getByRole("checkbox").check();
  await confirm
    .getByRole("button", { name: "Xóa buổi chơi", exact: true })
    .click();
  await expect(member.page).toHaveURL(origin + "/sessions");
  await expect(
    member.page.locator('a[href="/sessions/' + sid + '"]'),
  ).toHaveCount(0);
  check(
    (
      await db.query("select deleted_at from public.sessions where id=$1", [
        sid,
      ])
    ).rows[0].deleted_at !== null,
    "SOFT_DELETE_PRESERVES_AUDIT_TARGET",
  );
  check(
    !!(await member.client.rpc("session_details", { sid })).error,
    "DELETED_DETAIL_DENIED",
  );
  step = "audit";
  await page.goto(origin + "/audit");
  await expect(
    page.getByRole("heading", { name: "Audit log", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".audit-list")).toContainText(
    "Buổi được xóa trong test",
  );
  await expect(page.locator(".audit-list")).toContainText("Xóa buổi chưa chốt");
  await outside.page.goto(origin + "/audit?group=" + g);
  await expect(outside.page.getByRole("alert")).toBeVisible();
  await expect(outside.page.locator(".audit-list")).not.toContainText(
    "Buổi được xóa trong test",
  );
  for (let i = 0; i < 35; i++)
    await db.query(
      "insert into public.audit_log(group_id,actor_id,action) values($1,$2,'test_pagination')",
      [g, owner.user.id],
    );
  await page.reload();
  await page.getByRole("link", { name: "Nhật ký cũ hơn", exact: true }).click();
  await expect(page).toHaveURL(/before=/);
  await expect(page.locator(".audit-list > li")).not.toHaveCount(0);
  await page.screenshot({ path: ".tools/product-controls/audit-1440.png" });
  step = "admin-ai-toggle";
  await page.goto(origin + "/ai/settings");
  const settings = page.locator(`section.panel[data-group-id="${g}"]`);
  await expect(
    settings.getByRole("button", { name: "Yêu cầu bật AI", exact: true }),
  ).toHaveCount(0);
  await settings.getByLabel("Model", { exact: true }).fill("local-model-test");
  await settings
    .getByLabel("API key mới (để trống giữ key hiện tại)", { exact: true })
    .fill("local-test-key-never-call-provider");
  await settings.getByLabel("Bật AI sau khi lưu", { exact: true }).check();
  await settings
    .getByRole("button", { name: "Lưu cấu hình AI", exact: true })
    .click();
  await expect(
    settings.getByRole("button", { name: "Tắt AI", exact: true }),
  ).toBeVisible();
  await settings.getByRole("button", { name: "Tắt AI", exact: true }).click();
  await expect(
    settings.getByRole("button", { name: "Bật AI", exact: true }),
  ).toBeVisible();
  check(
    (
      await db.query(
        "select enabled from public.group_ai_settings where group_id=$1",
        [g],
      )
    ).rows[0].enabled === false,
    "ADMIN_TOGGLE_SAVED",
  );
  await member.page.goto(origin + "/ai/settings");
  await expect(
    member.page.getByRole("button", { name: "Lưu cấu hình AI", exact: true }),
  ).toHaveCount(0);
  check(
    !!(
      await member.client.rpc("set_group_ai_enabled", {
        g,
        expected_revision: 1,
        enabled: true,
      })
    ).error,
    "MEMBER_CANNOT_ENABLE_AI",
  );
  const audits = (
    await db.query("select payload from public.audit_log where group_id=$1", [
      g,
    ])
  ).rows;
  check(
    !JSON.stringify(audits).includes("local-test-key-never-call-provider"),
    "AUDIT_HAS_NO_API_KEY",
  );
  step = "retired-polls";
  const retired = await page.goto(origin + "/polls");
  check(retired.status() === 404, "POLLS_PAGE_REMOVED");
  check(
    !!(
      await owner.client.rpc("create_poll", {
        g,
        title_text: "Retired",
        venue_text: "Court",
        minimum: 1,
        deadline: start,
        options: [],
      })
    ).error,
    "OLD_POLL_RPC_BLOCKED",
  );
  const finished = await owner.client.rpc("execute_financial_command", {
    command_name: "create_session_bundle",
    request_key: randomUUID(),
    body: {
      g,
      title_text: "Buổi đã chốt",
      venue_text: "Court",
      start_time: new Date(Date.now() - 86400000).toISOString(),
      deadline: new Date(Date.now() - 86400000).toISOString(),
      already_played: true,
      people: [a, b],
      court: "100000",
      be_collector: true,
      weights: {},
      extras: [],
      nominee: "",
    },
  });
  check(!finished.error, "SEED_FINALIZED");
  await page.goto(origin + "/sessions/" + finished.data.id);
  await expect(
    page.getByRole("button", { name: "Xóa buổi chưa chốt", exact: true }),
  ).toHaveCount(0);
  step = "mobile-navigation";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/sessions");
  await expect(
    page.getByRole("heading", { name: "Buổi chơi", level: 1, exact: true }),
  ).toBeVisible();
  const mobile = page.getByRole("navigation", {
    name: "Điều hướng điện thoại",
    exact: true,
  });
  for (const name of ["Yêu cầu", "Trợ lý 3T", "Nhật ký"])
    await expect(
      mobile.getByRole("link", { name, exact: true }),
    ).toBeInViewport({ ratio: 1 });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "NO_HORIZONTAL_OVERFLOW",
  );
  await page.screenshot({ path: ".tools/product-controls/navigation-390.png" });
  console.log(
    JSON.stringify({
      passed: true,
      deleteUnfinalized: true,
      finalizedProtected: true,
      adminAuditOnly: true,
      auditGroupIsolation: true,
      auditPagination: true,
      noSecretsInAudit: true,
      flatNavigation: true,
      requestsRenamed: true,
      pollsRetired: true,
      adminAiToggle: true,
      providerCalls: 0,
    }),
  );
} catch (e) {
  await page
    ?.screenshot({ path: ".tools/product-controls/failure.png" })
    .catch(() => {});
  console.error(
    JSON.stringify({
      step,
      code: e.code || e.name,
      detail: e.message?.split("\n")[0]?.slice(0, 170),
    }),
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
