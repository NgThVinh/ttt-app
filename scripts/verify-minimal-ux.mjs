import { randomUUID } from "node:crypto";
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
  await page.locator("select").first().selectOption(group);
  await page
    .getByLabel("Tên buổi", { exact: true })
    .fill("UX preserved customization");
  await page.getByLabel("Địa điểm", { exact: true }).fill("Court");
  await page.getByLabel("Tiền sân (đ)", { exact: true }).fill("90000");
  await page.getByRole("button", { name: "Chọn tất cả", exact: true }).click();
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
  await page.screenshot({
    path: ".tools/minimal-ux/create-simple.png",
    fullPage: true,
    caret: "initial",
  });
  await page
    .getByRole("button", { name: "Tôi đã xem bảng chia", exact: true })
    .click();
  await page
    .getByText("Tùy chỉnh cách chia và phụ phí", { exact: true })
    .click();
  await page.getByLabel("Hệ số của UX B", { exact: true }).fill("0.5");
  check(
    await page
      .getByRole("button", { name: "Lưu buổi chơi", exact: true })
      .isDisabled(),
    "CHANGE_INVALIDATES_PREVIEW",
  );
  await page
    .getByRole("button", { name: "+ Nước 10k/người", exact: true })
    .click();
  await page.locator(".split-customization > summary").click();
  check(
    (await page.locator(".split-customization > summary").innerText()).includes(
      "Đã tùy chỉnh",
    ),
    "COLLAPSED_CUSTOMIZATION_STAYS_EXPLICIT",
  );
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
      localOnly: true,
      providerCalls: 0,
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ code: error.code || error.name, step }));
  process.exitCode = 1;
} finally {
  await app?.close();
}
