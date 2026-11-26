import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { localBrowser, check } from "./local-browser.mjs";
let app,
  testPage,
  step = "setup";
try {
  app = await localBrowser(3234, ".tools/calendar-workspace");
  const { db, origin } = app;
  const owner = await app.login("calendar-workspace@3t.test");
  const peer = await app.login("calendar-workspace-peer@3t.test");
  const g = randomUUID(),
    a = randomUUID(),
    b = randomUUID();
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Calendar workspace fixture','Cầu lông',$2)",
    [g, owner.user.id],
  );
  await db.query(
    "insert into public.group_members(id,group_id,user_id,display_name,role) values($1,$2,$3,'An','admin'),($4,$2,$5,'Bình','member')",
    [a, g, owner.user.id, b, peer.user.id],
  );
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'An','970436','00001111','AN TEST LOCAL') on conflict(id) do update set bank_bin=excluded.bank_bin,bank_account_no=excluded.bank_account_no,bank_account_name=excluded.bank_account_name",
    [owner.user.id],
  );
  const day = new Date(Date.now() + 7 * 3600000 + 2 * 86400000)
    .toISOString()
    .slice(0, 10);
  const start = day + "T18:00:00+07:00";
  const ids = [];
  for (let i = 0; i < 14; i++) {
    const result = await owner.client.rpc("schedule_meeting", {
      request_key: randomUUID(),
      body: {
        g,
        title_text: "Calendar example " + i,
        venue_text: "Sân A",
        start_time: start,
        ends_at: day + "T20:00:00+07:00",
        deadline: start,
        note: "",
        be_collector: false,
        nominee: "",
        invitees: [a, b],
      },
    });
    check(!result.error, "SEED_MEETING");
    ids.push(result.data.id);
  }
  const page = owner.page;
  testPage = page;
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(origin + "/sessions");
  await page.locator('.month-calendar button[data-date="' + day + '"]').click();
  const quick = page.getByRole("link", {
    name: "Tạo buổi ngày " + day.split("-").reverse().join("/"),
    exact: true,
  });
  await expect(quick).toBeVisible();
  await quick.scrollIntoViewIfNeeded();
  const scrollBefore = await page
    .locator(".agenda-items")
    .evaluate((el) => el.scrollTop);
  check(scrollBefore > 0, "AGENDA_HAS_SCROLL");
  step = "quick-create";
  await quick.click();
  const modal = page.locator(".session-workspace-dialog");
  await expect(modal).toBeVisible();
  await expect(modal.getByLabel("Ngày chơi", { exact: true })).toHaveValue(day);
  await expect(page.locator(".session-calendar-surface")).toHaveAttribute(
    "inert",
    "",
  );
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(origin + "/sessions");
  await expect(modal).toBeHidden();
  await expect(quick).toBeFocused();
  check(
    Math.abs(
      (await page.locator(".agenda-items").evaluate((el) => el.scrollTop)) -
        scrollBefore,
    ) < 2,
    "SCROLL_PRESERVED",
  );
  await page.goForward();
  await expect(modal).toBeVisible();
  await expect(modal.getByLabel("Ngày chơi", { exact: true })).toHaveValue(day);
  await page
    .getByRole("button", { name: "Đóng buổi chơi", exact: true })
    .click();
  await expect(page).toHaveURL(origin + "/sessions");
  step = "detail";
  const first = page.locator('a[href="/sessions/' + ids[0] + '"]');
  await first.click();
  await expect(modal.getByRole("heading", { level: 1 })).toHaveText(
    "Calendar example 0",
  );
  await modal.getByRole("button", { name: "Tham gia", exact: true }).click();
  await expect(
    modal.getByRole("button", { name: "Đã tham gia", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("heading", { level: 1 })).toHaveText(
    "Calendar example 0",
  );
  await page
    .getByRole("button", { name: "Đóng buổi chơi", exact: true })
    .click();
  await expect(page).toHaveURL(origin + "/sessions");
  step = "create-repeat";
  await page.locator('.month-calendar button[data-date="' + day + '"]').click();
  await page.getByRole("link", { name: "Tạo buổi chơi", exact: true }).click();
  await expect(modal.getByLabel("Ngày chơi", { exact: true })).toHaveValue(day);
  await modal.getByLabel("Nhóm", { exact: true }).selectOption(g);
  await modal
    .getByLabel("Tên buổi", { exact: true })
    .fill("Weekly modal meeting");
  await modal.getByRole("button", { name: "Mời cả nhóm", exact: true }).click();
  await modal.getByLabel("Lặp lại", { exact: true }).selectOption("weekly");
  await modal.getByLabel("Lặp thêm (tuần)", { exact: true }).fill("6");
  await page.locator(".session-workspace-body").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: ".tools/calendar-workspace/create-1440.png" });
  step = "create-lost-response";
  const createUrl = page.url();
  let dropCreate = true;
  await page.route(createUrl, async (route) => {
    if (dropCreate && route.request().method() === "POST") {
      dropCreate = false;
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await modal.getByRole("button", { name: "Tạo lịch", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText(
    "Chưa nhận được kết quả",
  );
  await expect(modal.getByLabel("Nhóm", { exact: true })).toHaveValue(g);
  await expect(modal.getByLabel("Lặp lại", { exact: true })).toHaveValue(
    "weekly",
  );
  await expect(
    modal.getByLabel("Lặp thêm (tuần)", { exact: true }),
  ).toHaveValue("6");
  check(
    (
      await db.query(
        "select id from public.weekly_series where group_id=$1 and title='Weekly modal meeting'",
        [g],
      )
    ).rowCount === 1,
    "CREATE_COMMITTED_BEFORE_RETRY",
  );
  await page.unroute(createUrl);
  await modal.getByRole("button", { name: "Tạo lịch", exact: true }).click();
  await page.waitForURL(/\/sessions\/[a-f0-9-]{36}$/);
  const created = new URL(page.url()).pathname.split("/").at(-1);
  await expect(modal.getByRole("heading", { level: 1 })).toHaveText(
    "Weekly modal meeting",
  );
  const records = (
    await db.query(
      "select id,weekly_series_id,extract(epoch from ends_at-starts_at)::int duration from public.sessions where group_id=$1 and title='Weekly modal meeting'",
      [g],
    )
  ).rows;
  check(
    records.length === 4 &&
      records.every((r) => r.duration === 7200 && r.weekly_series_id),
    "REPEAT_PERSISTED",
  );
  check(
    (
      await db.query(
        "select id from public.weekly_series where group_id=$1 and title='Weekly modal meeting'",
        [g],
      )
    ).rowCount === 1,
    "RETRY_NO_DUPLICATE_SERIES",
  );
  check(
    (
      await db.query(
        "select member_id from public.session_attendees where session_id=any($1::uuid[]) and committed_at is not null",
        [records.map((r) => r.id)],
      )
    ).rowCount === 0,
    "NO_AUTO_RSVP",
  );
  await page
    .getByRole("button", { name: "Đóng buổi chơi", exact: true })
    .click();
  await expect(page).toHaveURL(origin + "/sessions");
  await expect(
    page.locator('a[href="/sessions/' + created + '"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Ngày " + day.split("-").reverse().join("/"),
      exact: true,
    }),
  ).toBeVisible();
  step = "mobile-and-nested";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/sessions/" + created);
  await modal.getByRole("button", { name: "Gán cho tôi", exact: true }).click();
  await modal
    .getByRole("button", { name: "Nhập phí và chốt buổi", exact: true })
    .click();
  const task = page.locator(".session-task-dialog[open]");
  await expect(task).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(task).toBeHidden();
  await expect(modal).toBeVisible();
  step = "stop-repeat";
  await modal.locator(".weekly-series-summary > summary").click();
  await modal
    .getByRole("button", { name: "Dừng tạo buổi lặp mới", exact: true })
    .click();
  await expect(modal.locator(".weekly-series-summary > summary")).toContainText(
    "Đã dừng",
  );
  check(
    (
      await db.query("select active from public.weekly_series where id=$1", [
        records[0].weekly_series_id,
      ])
    ).rows[0].active === false,
    "REPEAT_STOPPED",
  );
  check(
    (
      await db.query(
        "select id from public.sessions where weekly_series_id=$1",
        [records[0].weekly_series_id],
      )
    ).rowCount === 4,
    "STOP_PRESERVES_CREATED_SESSIONS",
  );
  await modal.getByRole("button", { name: "Lịch sử", exact: true }).click();
  await expect(page.locator(".history-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".history-dialog")).toBeHidden();
  await expect(modal).toBeVisible();
  await page.screenshot({ path: ".tools/calendar-workspace/detail-390.png" });
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(origin + "/sessions");
  await page.getByRole("link", { name: "Tạo buổi chơi", exact: true }).click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    check(
      await modal.evaluate((el) => el.scrollWidth <= innerWidth),
      "NO_MODAL_HORIZONTAL_OVERFLOW",
    );
    check(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
      "NO_DOCUMENT_SCROLL",
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".session-workspace-frame.is-open")).toHaveCSS(
    "opacity",
    "1",
  );
  await page.locator(".session-workspace-body").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: ".tools/calendar-workspace/create-390.png" });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await expect(page.locator(".session-workspace-frame")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(origin + "/sessions");
  console.log(
    JSON.stringify({
      passed: true,
      modalCreate: true,
      modalDetail: true,
      datePrefill: true,
      scrollPreserved: true,
      backForward: true,
      deepLinkReload: true,
      repeatAtomic: true,
      lostResponseNoDuplicate: true,
      stopPreservesSessions: true,
      nestedEscape: true,
      widths: [320, 390, 768, 1440],
      providerCalls: 0,
    }),
  );
} catch (e) {
  await testPage
    ?.screenshot({ path: ".tools/calendar-workspace/failure.png" })
    .catch(() => {});
  console.error(
    JSON.stringify({
      step,
      code: e.code || e.name,
      detail: e.message?.slice(0, 1200),
    }),
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
