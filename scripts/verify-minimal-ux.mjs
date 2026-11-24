import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { localBrowser, check } from "./local-browser.mjs";
let app,
  step = "setup";
try {
  app = await localBrowser(3223, ".tools/minimal-ux");
  const { db, origin } = app;
  const owner = await app.login("minimal-owner@3t.test"),
    member = await app.login("minimal-member@3t.test");
  const group = randomUUID();
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'UX minimal fixture','Test',$2)",
    [group, owner.user.id],
  );
  for (const [index, actor] of [owner, member].entries()) {
    await db.query(
      "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,$2,'970436','TEST0001','TEST') on conflict(id) do update set bank_bin=excluded.bank_bin,bank_account_no=excluded.bank_account_no,bank_account_name=excluded.bank_account_name",
      [actor.user.id, index ? "UX B" : "UX A"],
    );
    await db.query(
      "insert into public.group_members(group_id,user_id,display_name,role) values($1,$2,$3,$4)",
      [
        group,
        actor.user.id,
        index ? "UX B" : "UX A",
        index ? "member" : "admin",
      ],
    );
  }
  const page = owner.page;
  step = "group";
  await page.goto(origin + "/groups/" + group);
  await page.getByRole("heading", { name: "Mời bạn", exact: true }).waitFor();
  const inviteY = await page
    .getByRole("heading", { name: "Mời bạn", exact: true })
    .evaluate((el) => el.getBoundingClientRect().top);
  const membersY = await page
    .getByRole("heading", { name: "Thành viên", exact: true })
    .evaluate((el) => el.getBoundingClientRect().top);
  check(inviteY < membersY, "INVITE_COMES_FIRST");
  check(
    !(await page.getByLabel("Thao tác với UX A", { exact: true }).isVisible()),
    "ROLE_MANAGEMENT_COLLAPSED",
  );
  await page.getByText("Quản lý UX A", { exact: true }).click();
  check(
    (await page
      .getByLabel("Thao tác với UX A", { exact: true })
      .inputValue()) === "",
    "NO_DEFAULT_ROLE_CHANGE",
  );
  check(
    !(await page
      .getByRole("heading", {
        name: "Chờ admin xác minh thành viên",
        exact: true,
      })
      .count()),
    "NO_EMPTY_ADMIN_SECTION",
  );
  await page.getByText("Quản lý UX A", { exact: true }).click();
  await page.getByRole("button", { name: "Tạo link mời", exact: true }).click();
  await page.locator('a[href*="/join/"]').waitFor();
  await page.screenshot({
    path: ".tools/minimal-ux/group-mobile.png",
    fullPage: true,
    caret: "initial",
  });
  step = "create";
  await page.goto(origin + "/sessions/new");
  await page
    .getByRole("button", { name: "Nhập buổi đã chơi", exact: true })
    .click();
  await page.locator("select").first().selectOption(group);
  check(
    !(await page.getByLabel("Tên buổi", { exact: true }).isVisible()),
    "DETAILS_COLLAPSED",
  );
  check(
    (await page.getByLabel("Tên buổi", { exact: true }).inputValue()).includes(
      "UX minimal fixture",
    ),
    "TITLE_SUGGESTED",
  );
  await page.locator(".suggested-details > summary").click();
  await page
    .getByLabel("Tên buổi", { exact: true })
    .fill("UX preserved customization");
  await page.getByLabel("Địa điểm", { exact: true }).fill("Court");
  await page.locator(".suggested-details > summary").click();
  const courtInput = page.getByLabel("Tiền sân (đ)", { exact: true });
  const dateInput = page.getByLabel("Ngày giờ (Việt Nam)", { exact: true });
  const originalTime = await dateInput.inputValue();
  const originalDate = originalTime.slice(0, 10);
  await page.locator(".date-picker > summary").first().click();
  const calendarDay = page.locator(
    `.date-picker [data-date="${originalDate}"]`,
  );
  await calendarDay.focus();
  await calendarDay.press("ArrowRight");
  const nextDate = new Date(
    new Date(originalDate + "T12:00:00Z").getTime() + 86400000,
  )
    .toISOString()
    .slice(0, 10);
  await expect(
    page.locator(`.date-picker [data-date="${nextDate}"]`),
  ).toBeFocused();
  await page
    .locator(`.date-picker [data-date="${nextDate}"]`)
    .press("ArrowLeft");
  await expect(calendarDay).toBeFocused();
  const monthEnd = new Date(
    Date.UTC(
      Number(originalDate.slice(0, 4)),
      Number(originalDate.slice(5, 7)),
      0,
    ),
  )
    .toISOString()
    .slice(0, 10);
  const firstNextMonth = new Date(
    new Date(monthEnd + "T12:00:00Z").getTime() + 86400000,
  )
    .toISOString()
    .slice(0, 10);
  await page.locator(`.date-picker [data-date="${monthEnd}"]`).focus();
  await page
    .locator(`.date-picker [data-date="${monthEnd}"]`)
    .press("ArrowRight");
  await expect(
    page.locator(`.date-picker [data-date="${firstNextMonth}"]`),
  ).toBeFocused();
  await page
    .locator(`.date-picker [data-date="${firstNextMonth}"]`)
    .press("ArrowLeft");
  await expect(
    page.locator(`.date-picker [data-date="${monthEnd}"]`),
  ).toBeFocused();
  await calendarDay.focus();
  await calendarDay.press("Enter");
  check(
    (await dateInput.inputValue()) === originalTime,
    "CALENDAR_PRESERVES_TIME",
  );
  check((await courtInput.inputValue()) === "", "NO_ASSUMED_COURT_PRICE");
  await page
    .getByRole("button", { name: "2. Người chơi", exact: true })
    .click();
  await page.getByRole("button", { name: "Chọn tất cả", exact: true }).click();
  await page
    .getByRole("button", { name: "1. Lịch & tiền", exact: true })
    .click();
  await courtInput.fill("400000.5");
  await courtInput.press("Tab");
  check(
    (await page.locator(".field-error").first().innerText()).includes(
      "không có phần lẻ",
    ),
    "DECIMAL_AMOUNT_EXPLAINED_INLINE",
  );
  check(
    !(await page
      .getByRole("button", { name: "Tôi đã xem bảng chia", exact: true })
      .count()),
    "NO_DECIMAL_PREVIEW",
  );
  for (const input of ["90.000", "90,000", " 90000 "]) {
    await courtInput.fill(input);
    await courtInput.press("Tab");
    check(
      (await page.locator(".split-preview").innerText()).includes("45.000"),
      "LOCALE_AMOUNT_PREVIEW",
    );
    check(
      (await courtInput.inputValue()) === "90.000",
      "LOCALE_AMOUNT_FORMATTED_ON_BLUR",
    );
  }
  await page
    .getByRole("button", { name: "2. Người chơi", exact: true })
    .click();
  check(
    await page
      .locator(".member-choice > label")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height >= 44),
    "MEMBER_ROW_TOUCH_TARGET",
  );
  check(
    !(await page.getByLabel("Hệ số của UX B", { exact: true }).isVisible()),
    "WEIGHTS_HIDDEN_BY_DEFAULT",
  );
  check(
    !(await page
      .getByRole("button", { name: "Thêm khoản chi", exact: true })
      .isVisible()),
    "EXTRAS_HIDDEN_BY_DEFAULT",
  );
  await page
    .getByRole("button", { name: "1. Lịch & tiền", exact: true })
    .click();
  await page.screenshot({
    path: ".tools/minimal-ux/create-simple.png",
    fullPage: true,
    caret: "initial",
  });
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "CREATE_NO_OVERFLOW",
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "3. Xem lại", exact: true }).click();
  await page
    .getByRole("button", { name: "Tôi đã xem bảng chia", exact: true })
    .click();
  await page
    .getByRole("button", { name: "2. Người chơi", exact: true })
    .click();
  await page
    .getByText("Tùy chỉnh cách chia và phụ phí", { exact: true })
    .click();
  await page.getByLabel("Hệ số của UX B", { exact: true }).fill("0,5");
  check(
    (await page.locator('input[name="reviewed"]').inputValue()) === "no",
    "CHANGE_INVALIDATES_PREVIEW",
  );
  await page
    .getByRole("button", { name: "+ Nước 10k/người", exact: true })
    .click();
  await page.getByLabel("Số tiền (đ)", { exact: true }).fill("10,000");
  await page.locator(".split-customization > summary").click();
  check(
    (await page.locator(".split-customization > summary").innerText()).includes(
      "Đã tùy chỉnh",
    ),
    "COLLAPSED_CUSTOMIZATION_STAYS_EXPLICIT",
  );
  await page.getByRole("button", { name: "3. Xem lại", exact: true }).click();
  await page
    .getByRole("button", { name: "Tôi đã xem bảng chia", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Lưu buổi chơi", exact: true })
    .click();
  await page.waitForURL(/\/sessions\/[a-f0-9-]{36}$/);
  const sid = new URL(page.url()).pathname.split("/").pop();
  const payment = (
    await db.query(
      "select amount from public.settlements where session_id=$1 and status='pending'",
      [sid],
    )
  ).rows[0];
  check(payment.amount === "40000", "HIDDEN_WEIGHTS_AND_EXTRAS_PRESERVED");
  await page.goto(origin + "/debts");
  await expect(
    page.getByRole("table", { name: "Bảng công nợ", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("table")
      .locator("tr")
      .filter({ has: page.locator(`a[href="/sessions/${sid}"]`) })
      .getByText("40.000đ", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 360, height: 900 });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "DEBT_TABLE_NO_PAGE_OVERFLOW",
  );
  await page.screenshot({ path: ".tools/minimal-ux/debt-table-360.png" });
  await page.goto(origin + "/sessions");
  await page.getByRole("button", { name: "Lịch tháng", exact: true }).waitFor();
  await page.locator(`.calendar [data-date="${originalDate}"]`).click();
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "CALENDAR_NO_PAGE_OVERFLOW",
  );
  await page.screenshot({ path: ".tools/minimal-ux/calendar-360.png" });
  await expect(page.locator(`a[href="/sessions/${sid}"]`)).toBeVisible();
  await page.getByRole("button", { name: "Danh sách", exact: true }).click();
  await expect(page.locator(".calendar")).toHaveCount(0);
  await page.goto(origin + "/sessions/" + sid);
  await expect(page).toHaveTitle("Chi tiết buổi chơi · 3T");
  await page.goto(origin + "/sessions/new");
  await page.locator("select").first().selectOption(group);
  check(
    (await page.getByLabel("Địa điểm", { exact: true }).inputValue()) ===
      "Court",
    "RECENT_VENUE_SUGGESTED",
  );
  await page.goto(origin + "/polls");
  await page.locator("#poll-group").selectOption(group);
  check(
    (await page.getByLabel("Địa điểm", { exact: true }).inputValue()) ===
      "Court",
    "POLL_VENUE_SUGGESTED",
  );
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "POLL_NO_OVERFLOW",
    );
    await page.screenshot({
      path: `.tools/minimal-ux/poll-${width}.png`,
      fullPage: true,
    });
  }
  const localTime = (hours) =>
    new Date(Date.now() + (hours + 7) * 3600000).toISOString().slice(0, 16);
  await page.locator("#poll-deadline").fill(localTime(24));
  for (const [i, hour] of [48, 72].entries()) {
    await page.locator(`#starts-${i}`).fill(localTime(hour));
    await page.locator(`#ends-${i}`).fill(localTime(hour + 1));
  }
  await page.getByRole("button", { name: "Tạo thăm dò", exact: true }).click();
  await page.waitForURL(/\/polls\/[a-f0-9-]{36}$/);
  step = "bank-preflight";
  await db.query(
    "update public.profiles set bank_bin=null,bank_account_no=null,bank_account_name=null where id=$1",
    [owner.user.id],
  );
  await page.goto(origin + "/sessions/new");
  await page
    .getByRole("button", { name: "Nhập buổi đã chơi", exact: true })
    .click();
  await page.locator("select").first().selectOption(group);
  await expect(page.locator(".bank-setup-notice")).toBeVisible();
  await page.getByLabel("Tiền sân (đ)", { exact: true }).fill("123000");
  await db.query(
    "update public.profiles set bank_bin='970436',bank_account_no='TEST0001',bank_account_name='TEST' where id=$1",
    [owner.user.id],
  );
  await page
    .getByRole("button", { name: "Đã cập nhật · Kiểm tra lại", exact: true })
    .click();
  await expect(page.locator(".bank-setup-notice")).toHaveCount(0);
  await expect(page.getByLabel("Tiền sân (đ)", { exact: true })).toHaveValue(
    "123.000",
  );
  await db.query(
    "insert into public.group_members(group_id,display_name) select $1,'Khách giả lập ' || n from generate_series(1,28) n",
    [group],
  );
  await page.goto(origin + "/sessions/new");
  await page
    .getByRole("button", { name: "Nhập buổi đã chơi", exact: true })
    .click();
  await page.locator("select").first().selectOption(group);
  await page
    .getByRole("button", { name: "2. Người chơi", exact: true })
    .click();
  check(
    await page
      .locator(".participant-list")
      .evaluate(
        (el) => el.clientHeight <= 264 && el.scrollHeight > el.clientHeight,
      ),
    "THIRTY_MEMBERS_BOUNDED",
  );
  await page.screenshot({
    path: ".tools/minimal-ux/thirty-members.png",
    fullPage: true,
  });
  step = "feedback-errors";
  await page.goto(origin + "/sessions/" + randomUUID());
  await page
    .getByRole("heading", { name: "Không tìm thấy trang", exact: true })
    .waitFor();
  await page.getByRole("link", { name: "Về trang chủ", exact: true }).waitFor();
  const headers = await fetch(origin + "/login");
  check(headers.headers.get("x-frame-options") === "DENY", "FRAME_HEADER");
  check(
    headers.headers.get("x-content-type-options") === "nosniff",
    "CONTENT_TYPE_HEADER",
  );
  check(
    headers.headers
      .get("content-security-policy")
      .includes("frame-ancestors 'none'"),
    "BASELINE_CSP",
  );
  check(
    (await (await fetch(origin + "/robots.txt")).text()).includes(
      "Disallow: /",
    ),
    "ROBOTS_PUBLIC",
  );
  const invitePath = "/join/" + "a".repeat(64);
  const rootError = await fetch(
    origin +
      "/?error=invalid_request&error_code=flow_state_already_used&next=" +
      encodeURIComponent(invitePath),
    { redirect: "manual" },
  );
  check(
    new URL(rootError.headers.get("location"), origin).pathname ===
      "/auth/callback",
    "ROOT_AUTH_ERROR_RECOVERED",
  );
  const callbackError = await fetch(
    new URL(rootError.headers.get("location"), origin),
    {
      redirect: "manual",
    },
  );
  const loginUrl = new URL(callbackError.headers.get("location"), origin);
  check(
    loginUrl.searchParams.get("error") === "used_link" &&
      loginUrl.searchParams.get("next") === invitePath,
    "AUTH_RETRY_PRESERVES_INVITE",
  );
  const loginPage = await (await fetch(loginUrl)).text();
  check(
    loginPage.includes("Link đăng nhập đã được dùng."),
    "AUTH_ERROR_EXPLAINED",
  );
  step = "auth-session-resume";
  await page.goto(origin + "/?error_code=flow_state_already_used");
  await expect(page).toHaveURL(origin + "/");
  step = "auth-home-title";
  await expect(page).toHaveTitle("Trang chủ · 3T");
  step = "payment";
  await member.page.goto(origin + "/sessions/" + sid);
  const panel = member.page
    .locator("article.session-row")
    .filter({ hasText: "Mã tham chiếu:" });
  const button = panel.getByRole("button", {
    name: "Tôi đã chuyển",
    exact: true,
  });
  await button.waitFor();
  check(
    !(await panel.getByLabel("Chọn ảnh biên lai").isVisible()),
    "PROOF_INPUT_HIDDEN",
  );
  check(
    (await button.evaluate((el) => el.getBoundingClientRect().top)) <
      (await panel
        .locator("summary")
        .evaluate((el) => el.getBoundingClientRect().top)),
    "PAYMENT_ACTION_BEFORE_PROOF",
  );
  for (const [name, screen] of [
    ["group", page],
    ["payment", member.page],
  ]) {
    if (name === "group") await page.goto(origin + "/groups/" + group);
    for (const width of [390, 1440]) {
      await screen.setViewportSize({ width, height: 900 });
      check(
        await screen.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "NO_OVERFLOW",
      );
      await screen.screenshot({
        path: `.tools/minimal-ux/${name}-${width}.png`,
        fullPage: true,
        caret: "initial",
      });
    }
  }
  console.log(
    JSON.stringify({
      passed: true,
      inviteFirst: true,
      roleChoiceExplicit: true,
      defaultEqualSplit: true,
      customizationPreservedWhenClosed: true,
      paymentBeforeOptionalEvidence: true,
      responsive: true,
      localizedNumberInputs: true,
      decimalInputRejected: true,
      pageTitlesAndNotFound: true,
      securityHeadersAndRobots: true,
      authErrorRecovery: true,
      localOnly: true,
      providerCalls: 0,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      code: error.code || error.name,
      step,
      assertion: error.matcherResult?.message?.slice(0, 800),
    }),
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
