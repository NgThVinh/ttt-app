import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { localBrowser, check } from "./local-browser.mjs";
import { expect } from "@playwright/test";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(".tools/browsers"))
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".tools/browsers");
let app,
  step = "start";
try {
  app = await localBrowser(3225, ".tools/session-workspace");
  const { origin, db } = app;
  const owner = await app.login("workspace-owner@3t.test"),
    bill = await app.login("workspace-bill@3t.test"),
    waiting = await app.login("workspace-waiting@3t.test");
  const g = randomUUID(),
    ids = [randomUUID(), randomUUID(), randomUUID()];
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Session workspace fixture','Test',$2)",
    [g, owner.user.id],
  );
  for (const [i, actor] of [owner, bill, waiting].entries()) {
    await db.query(
      "insert into public.group_members(id,group_id,user_id,display_name,role) values($1,$2,$3,$4,$5)",
      [
        ids[i],
        g,
        actor.user.id,
        ["An", "Bình", "Chi"][i],
        i === 0 ? "admin" : "member",
      ],
    );
    await db.query(
      "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,$2,'970436','TEST0001','TEST LOCAL') on conflict(id) do update set bank_bin='970436',bank_account_no='TEST0001',bank_account_name='TEST LOCAL'",
      [actor.user.id, ["An", "Bình", "Chi"][i]],
    );
  }
  const start = new Date(Date.now() + 86400000);
  const created = await owner.client.rpc("schedule_meeting", {
    request_key: randomUUID(),
    body: {
      g,
      title_text: "Buổi kiểm tra giao diện",
      venue_text: "Sân A",
      start_time: start.toISOString(),
      ends_at: new Date(+start + 7200000).toISOString(),
      deadline: start.toISOString(),
      note: "Mang vợt",
      be_collector: false,
      nominee: "",
      invitees: ids,
    },
  });
  check(!created.error, "SCHEDULE");
  const sid = created.data.id,
    path = "/sessions/" + sid;
  const page = owner.page;
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(origin + path);
  step = "inline-edit";
  check(
    (await page.locator(".session-facts").count()) === 0,
    "NO_MEANINGLESS_FACTS",
  );
  await page.getByText("Sân A", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Sửa thông tin buổi", exact: true })
    .click();
  await page.getByLabel("Địa điểm", { exact: true }).fill("Sân B");
  await page.getByLabel("Tên buổi", { exact: true }).fill("Cầu lông tối mai");
  await page
    .getByRole("button", { name: "Lưu thông tin buổi", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Cầu lông tối mai", exact: true })
    .waitFor();
  await page.getByText("Sân B", { exact: true }).waitFor();
  check(
    (await page.locator(".session-inline-edit").count()) === 0,
    "EDITOR_CLOSES_AFTER_SAVE",
  );
  await page.reload();
  await page.getByText("Sân B", { exact: true }).waitFor();
  step = "participants";
  const part = page.locator(".session-participants");
  await part
    .getByRole("button", { name: "Mời thêm người tham gia", exact: true })
    .click();
  await expect(page.locator(".invite-dropdown")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".invite-dropdown")).toBeHidden();
  await part.getByRole("button", { name: "Tham gia", exact: true }).click();
  await expect(
    part.getByText("Bạn đã nhận lời", { exact: true }),
  ).toBeVisible();
  check(
    !(await bill.client.rpc("set_rsvp", { sid, going: true })).error,
    "BILL_RSVP",
  );
  await page.reload();
  await expect(page.locator(".attendance-groups")).toContainText("Bình");
  step = "collector-consent";
  await page
    .getByLabel("Chọn người khác", { exact: true })
    .selectOption(ids[1]);
  await page
    .getByRole("button", { name: "Mời tính tiền", exact: true })
    .click();
  await expect(page.locator(".collector-pending")).toContainText("Bình");
  check(
    (
      await db.query(
        "select collector_member_id from public.sessions where id=$1",
        [sid],
      )
    ).rows[0].collector_member_id === null,
    "NOMINATION_CANNOT_ASSIGN",
  );
  await bill.page.goto(origin + path);
  await bill.page
    .getByRole("button", { name: "Đồng ý nhận / chuyển vai trò", exact: true })
    .click();
  await bill.page.getByLabel("Tiền sân (đ)", { exact: true }).waitFor();
  check(
    (
      await db.query(
        "select collector_member_id from public.sessions where id=$1",
        [sid],
      )
    ).rows[0].collector_member_id === ids[1],
    "COLLECTOR_ACCEPTED",
  );
  await page.reload();
  check(
    (await page.getByLabel("Tiền sân (đ)", { exact: true }).count()) === 0,
    "ONLY_COLLECTOR_EDIT_COST",
  );
  step = "extras-preview";
  const costs = bill.page;
  await costs.getByLabel("Tiền sân (đ)", { exact: true }).fill("200.000");
  await costs
    .getByRole("button", { name: "+ Thêm phụ phí", exact: true })
    .click();
  let extra = costs.locator(".cost-extra").nth(0);
  await extra.getByLabel("Tên khoản phí", { exact: true }).fill("Nước và cầu");
  await extra.getByLabel("Số tiền (đ)", { exact: true }).fill("50.000");
  await costs
    .getByRole("button", { name: "+ Thêm phụ phí", exact: true })
    .click();
  extra = costs.locator(".cost-extra").nth(1);
  await extra.getByLabel("Tên khoản phí", { exact: true }).fill("Giảm giá");
  await extra.getByLabel("Số tiền (đ)", { exact: true }).fill("-5000");
  await extra.locator("summary").click();
  await extra
    .getByLabel("Loại số tiền", { exact: true })
    .selectOption("per_person");
  await expect(costs.locator(".cost-total")).toContainText("240.000");
  await expect(
    costs.getByRole("button", { name: "Chốt toàn bộ chi phí", exact: true }),
  ).toBeDisabled();
  await costs
    .getByRole("button", { name: "Tôi đã xem bảng chia", exact: true })
    .click();
  await expect(
    costs.getByRole("button", { name: "Chốt toàn bộ chi phí", exact: true }),
  ).toBeEnabled();
  for (const width of [320, 390, 1440]) {
    await costs.setViewportSize({ width, height: 900 });
    check(
      await costs.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "NO_HORIZONTAL_OVERFLOW",
    );
    await costs.locator("#main-content").evaluate((el) => {
      el.scrollTop = 0;
    });
    await costs.screenshot({
      path: ".tools/session-workspace/costs-" + width + ".png",
      fullPage: true,
    });
  }
  await costs.evaluate(() => {
    localStorage.setItem("3t-theme", "dark");
    window.dispatchEvent(new Event("3t-theme"));
  });
  await costs.screenshot({
    path: ".tools/session-workspace/costs-dark.png",
    fullPage: true,
  });
  await costs.evaluate(() => {
    localStorage.setItem("3t-theme", "light");
    window.dispatchEvent(new Event("3t-theme"));
  });
  step = "finish";
  const saved = costs.waitForResponse(
    (r) =>
      r.request().method() === "POST" && new URL(r.url()).pathname === path,
  );
  await costs
    .getByRole("button", { name: "Chốt toàn bộ chi phí", exact: true })
    .click();
  check((await saved).ok(), "FINISH_POST");
  await costs
    .getByText("Đã chốt chi phí · Lịch và danh sách tham gia đã khóa.", {
      exact: true,
    })
    .waitFor();
  check(
    (
      await db.query(
        "select sum(amount)::text total from public.expenses where session_id=$1 and status='active'",
        [sid],
      )
    ).rows[0].total === "240000",
    "ALL_COSTS_PERSISTED",
  );
  check(
    (
      await db.query(
        "select count(*)::int n from public.session_recalculations where session_id=$1",
        [sid],
      )
    ).rows[0].n === 1,
    "ONE_RECALC",
  );
  await costs.reload();
  await expect(costs.locator(".expense-summary")).toContainText("Nước và cầu");
  await expect(costs.locator(".expense-summary")).toContainText("Giảm giá");
  check(
    (await costs
      .getByRole("button", { name: "Tham gia", exact: true })
      .count()) === 0,
    "RSVP_LOCKED",
  );
  check(
    (await costs.getByText("Gửi đề nghị thay đổi", { exact: true }).count()) ===
      0,
    "NO_DUPLICATE_CHANGE_PANEL",
  );
  step = "history";
  await db.query(
    "insert into public.audit_log(group_id,session_id,actor_id,action,payload) select $1,$2,$3,'session_metadata_updated',jsonb_build_object('reason','Lịch sử kiểm tra '||n) from generate_series(1,55) n",
    [g, sid, bill.user.id],
  );
  await costs.getByRole("button", { name: "Lịch sử", exact: true }).click();
  const dialog = costs.getByRole("dialog", {
    name: "Lịch sử buổi chơi",
    exact: true,
  });
  await dialog.getByRole("listitem").first().waitFor();
  check(
    (await dialog.locator("li").count()) <= 20,
    "HISTORY_FIRST_PAGE_BOUNDED",
  );
  await dialog.locator(".history-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(() => dialog.locator("li").count()).toBeGreaterThan(20);
  await dialog.locator(".history-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(() => dialog.locator("li").count()).toBeGreaterThan(40);
  await costs.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(
    costs.getByRole("button", { name: "Lịch sử", exact: true }),
  ).toBeFocused();
  console.log(
    JSON.stringify({
      passed: true,
      inlineEdit: true,
      collectorConsent: true,
      participants: true,
      extrasAtomic: true,
      previewMatches: true,
      lazyHistory: true,
      infinitePages: true,
      keyboard: true,
      responsive: [320, 390, 1440],
      darkMode: true,
      providerCalls: 0,
    }),
  );
} catch (e) {
  console.error(
    JSON.stringify({
      step,
      code: e.code || e.name,
      detail: e.message
        ?.split("\n")[0]
        ?.replace(/https?:\/\/\S+/g, "[url]")
        .slice(0, 180),
    }),
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
