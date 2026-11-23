import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { expect } from "@playwright/test";
import { localBrowser, check } from "./local-browser.mjs";

// This runner is outside the app bundle. No application authentication bypass.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(".tools/browsers"))
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".tools/browsers");

let app;
let step = "local-stack";
try {
  const automated = process.argv.includes("--check");
  app = await localBrowser(3225, ".tools/simulation", { headed: !automated });
  const { db, origin } = app;
  step = "seed";
  const run = randomUUID();
  const owner = await app.login(`sim-admin-${run}@3t.test`);
  const member = await app.login(`sim-member-${run}@3t.test`);
  const outsider = await app.login(`sim-outsider-${run}@3t.test`);
  const group = randomUUID();
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,$2,'Cầu lông',$3)",
    [group, `[GIẢ LẬP] Nhóm bạn ${run.slice(0, 6)}`, owner.user.id],
  );
  for (const [actor, name, role] of [
    [owner, "An giả lập · Admin", "admin"],
    [member, "Bình giả lập · Thành viên", "member"],
  ]) {
    await db.query(
      "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,$2,'970436','TEST0001','GIA LAP KHONG CHUYEN TIEN') on conflict(id) do update set display_name=excluded.display_name",
      [actor.user.id, name],
    );
    await db.query(
      "insert into public.group_members(group_id,user_id,display_name,role) values($1,$2,$3,$4)",
      [group, actor.user.id, name, role],
    );
  }
  step = "group-pages";
  await owner.page.goto(`${origin}/groups/${group}`);
  await member.page.goto(`${origin}/groups/${group}`);
  await outsider.page.goto(origin);
  await expect(outsider.page).toHaveURL(origin + "/welcome");
  if (automated) {
    step = "create-session";
    await owner.page.goto(origin + "/sessions/new");
    await owner.page.locator("select").first().selectOption(group);
    await owner.page.locator(".suggested-details > summary").click();
    await owner.page
      .getByLabel("Tên buổi", { exact: true })
      .fill("Buổi giả lập · Không chuyển tiền thật");
    await owner.page
      .getByLabel("Địa điểm", { exact: true })
      .fill("Sân giả lập");
    await owner.page
      .getByLabel("Tiền sân (đ)", { exact: true })
      .fill("100.000");
    await owner.page
      .getByRole("button", { name: "2. Người chơi", exact: true })
      .click();
    await owner.page
      .getByRole("button", { name: "Chọn tất cả", exact: true })
      .click();
    await owner.page
      .getByRole("button", { name: "3. Xem lại", exact: true })
      .click();
    await owner.page
      .getByRole("button", { name: "Tôi đã xem bảng chia", exact: true })
      .click();
    await owner.page
      .getByRole("button", { name: "Lưu buổi chơi", exact: true })
      .click();
    await owner.page.waitForURL(/\/sessions\/[a-f0-9-]{36}$/);
    const sessionUrl = owner.page.url();
    const sid = new URL(sessionUrl).pathname.split("/").pop();
    check(
      (
        await db.query(
          "select amount from public.settlements where session_id=$1",
          [sid],
        )
      ).rows[0]?.amount === "50000",
      "SPLIT_MISMATCH",
    );
    step = "payment";
    await member.page.goto(sessionUrl);
    await member.page
      .getByRole("button", { name: "Tôi đã chuyển", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "select status from public.settlements where session_id=$1",
              [sid],
            )
          ).rows[0]?.status,
      )
      .toBe("marked_paid");
    await owner.page.reload();
    await owner.page
      .getByRole("button", { name: "Đã nhận", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "select status from public.settlements where session_id=$1",
              [sid],
            )
          ).rows[0]?.status,
      )
      .toBe("confirmed");
    step = "outsider-denied";
    await outsider.page.goto(sessionUrl);
    await expect(outsider.page).toHaveURL(origin + "/welcome");
    console.log(
      JSON.stringify({
        passed: true,
        localOnly: true,
        roles: 3,
        sessionCreated: true,
        split: "50000",
        paymentConfirmed: true,
        outsiderDenied: true,
        providerCalls: 0,
      }),
    );
  } else {
    console.log(
      `Giả lập tại ${origin}: đã mở 3 cửa sổ riêng cho Admin, Thành viên và Người chưa vào nhóm.`,
    );
    console.log(
      "Dữ liệu và tài khoản đều giả, chỉ lưu ở Supabase local. AI tắt. Ctrl+C để đóng; không reset database.",
    );
    await new Promise((done) => {
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
    });
  }
} catch (error) {
  console.error(
    JSON.stringify({
      passed: false,
      step,
      code: error.code || error.name,
      hint: "Cần Docker + Supabase local đang chạy, Chromium của Playwright và port 3225 trống. Xem docs/simulation.md.",
    }),
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
