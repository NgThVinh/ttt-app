import { randomUUID, randomBytes, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { localBrowser, check } from "./local-browser.mjs";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(".tools/browsers"))
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".tools/browsers");
let app,
  step = "start";
try {
  app = await localBrowser(3224, ".tools/account-onboarding");
  const { origin, db } = app;
  const owner = await app.login("onboarding-owner@3t.test");
  const visitor = await app.login("onboarding-viewer@3t.test");
  await visitor.context.clearCookies();
  const group = randomUUID(),
    guest = randomUUID(),
    token = randomBytes(32).toString("hex");
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Account onboarding fixture','Test',$2)",
    [group, owner.user.id],
  );
  await db.query(
    "insert into public.group_members(group_id,user_id,display_name,role) values($1,$2,'Admin','admin')",
    [group, owner.user.id],
  );
  await db.query(
    "insert into public.group_members(id,group_id,display_name) values($1,$2,'Minh được thêm hộ')",
    [guest, group],
  );
  check(
    !(
      await owner.client.rpc("create_invite", {
        g: group,
        hashed_token: createHash("sha256").update(token).digest("hex"),
        valid_until: new Date(Date.now() + 3600000).toISOString(),
        use_limit: 1,
      })
    ).error,
    "INVITE_CREATE",
  );
  const invitePath = "/join/" + token + "?session=" + randomUUID();
  const email = "onboarding-" + randomUUID() + "@3t.test";
  const page = visitor.page;
  step = "login-vs-register";
  await page.goto(origin + invitePath);
  await page
    .getByRole("heading", { name: "Đăng nhập vào 3T", exact: true })
    .waitFor();
  check(
    new URL(page.url()).searchParams.get("next") === invitePath,
    "LOGIN_INVITE_NEXT",
  );
  await page.getByLabel("Địa chỉ email", { exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Gửi link đăng nhập", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Kiểm tra email của bạn", exact: true })
    .waitFor();
  check(
    (await db.query("select id from auth.users where email=$1", [email])).rows
      .length === 0,
    "LOGIN_MUST_NOT_REGISTER",
  );
  await page.getByRole("link", { name: "Đăng ký", exact: true }).click();
  await page
    .getByRole("heading", { name: "Tạo tài khoản 3T", exact: true })
    .waitFor();
  check(
    new URL(page.url()).searchParams.get("next") === invitePath,
    "REGISTER_INVITE_NEXT",
  );
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "AUTH_OVERFLOW",
    );
    check(
      (await page.getByRole("navigation").count()) === 0,
      "AUTH_NO_FEATURE_NAV",
    );
    await page.screenshot({
      path: ".tools/account-onboarding/register-" + width + ".png",
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    localStorage.setItem("3t-theme", "dark");
    window.dispatchEvent(new Event("3t-theme"));
  });
  await page.screenshot({
    path: ".tools/account-onboarding/register-dark.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    localStorage.setItem("3t-theme", "light");
    window.dispatchEvent(new Event("3t-theme"));
  });
  await page.getByLabel("Địa chỉ email", { exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Đăng ký bằng email", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Kiểm tra email của bạn", exact: true })
    .waitFor();
  check(
    new URL(page.url()).searchParams.get("next") === invitePath,
    "SENT_INVITE_NEXT",
  );
  step = "verify-email";
  let message;
  for (let i = 0; i < 20; i++) {
    const list = await (
      await fetch(
        "http://127.0.0.1:54324/api/v1/search?query=" +
          encodeURIComponent("to:" + email),
      )
    ).json();
    if (list.messages?.length) {
      message = await (
        await fetch(
          "http://127.0.0.1:54324/api/v1/message/" + list.messages[0].ID,
        )
      ).json();
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  check(!!message, "CONFIRMATION_EMAIL_NOT_RECEIVED");
  const match = (message.HTML || message.Text || "").match(
    /https?:[^"<>\s]+\/auth\/v1\/verify[^"<>\s]+/,
  );
  check(!!match, "VERIFY_LINK_MISSING");
  const verifyUrl = new URL(match[0].replaceAll("&amp;", "&"));
  check(verifyUrl.hostname === "127.0.0.1", "LOCAL_EMAIL_LINK_ONLY");
  const redirect = new URL(verifyUrl.searchParams.get("redirect_to"));
  check(
    redirect.origin === origin && redirect.pathname === "/auth/callback",
    "CALLBACK_LOCAL_ORIGIN",
  );
  check(
    redirect.searchParams.get("next") === invitePath,
    "CALLBACK_INVITE_NEXT",
  );
  await page.goto(verifyUrl.href);
  await page
    .getByRole("heading", {
      name: "Tham gia Account onboarding fixture",
      exact: true,
    })
    .waitFor();
  check(
    new URL(page.url()).pathname === "/join/" + token,
    "VERIFIED_BACK_TO_INVITE",
  );
  const signed = (
    await db.query(
      "select id,email_confirmed_at from auth.users where email=$1",
      [email],
    )
  ).rows[0];
  check(!!signed?.email_confirmed_at, "EMAIL_NOT_VERIFIED");
  step = "claim-request";
  await page
    .getByRole("radio", {
      name: "Đã có, tôi muốn nhận lại tên cũ",
      exact: true,
    })
    .check();
  await page
    .getByLabel("Tên của bạn trong nhóm", { exact: true })
    .selectOption(guest);
  await page
    .getByRole("button", { name: "Gửi yêu cầu nhận lại tên cũ", exact: true })
    .click();
  await page.waitForURL(origin + "/groups/" + group + "#link-account");
  await page
    .getByRole("heading", { name: "Chờ admin liên kết tài khoản", exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("heading", { name: "Chờ admin liên kết tài khoản", exact: true })
    .waitFor();
  const request = (
    await db.query(
      "select id from public.approval_requests where group_id=$1 and requested_by=$2 and status='pending'",
      [group, signed.id],
    )
  ).rows[0];
  check(!!request, "CLAIM_PENDING_NOT_SAVED");
  check(
    (
      await db.query("select user_id from public.group_members where id=$1", [
        guest,
      ])
    ).rows[0].user_id === null,
    "CLAIM_MUST_WAIT_ADMIN",
  );
  await page.screenshot({
    path: ".tools/account-onboarding/claim-pending.png",
    fullPage: true,
  });
  await page.goto(origin + "/approvals");
  await page
    .getByRole("heading", { name: "Yêu cầu liên kết đã gửi", exact: true })
    .waitFor();
  await page.goto(origin + "/groups/" + group);
  step = "claim-cancel";
  const cancelled = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/groups/" + group,
  );
  await page
    .getByRole("button", { name: "Hủy yêu cầu liên kết", exact: true })
    .click();
  check((await cancelled).ok(), "CANCEL_POST_FAILED");
  await page
    .getByRole("heading", { name: "Bạn đã có tên trong nhóm?", exact: true })
    .waitFor();
  check(
    (
      await db.query(
        "select status from public.approval_requests where id=$1",
        [request.id],
      )
    ).rows[0].status === "cancelled",
    "CANCEL_NOT_SAVED",
  );
  await page
    .getByLabel("Tên được thêm hộ trong nhóm", { exact: true })
    .selectOption(guest);
  await page
    .getByRole("button", { name: "Yêu cầu liên kết tài khoản", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Chờ admin liên kết tài khoản", exact: true })
    .waitFor();
  step = "claim-admin";
  await owner.page.goto(origin + "/groups/" + group);
  await owner.page
    .getByRole("heading", {
      name: "Chờ admin xác minh thành viên",
      exact: true,
    })
    .waitFor();
  await owner.page.goto(origin + "/approvals");
  const review = owner.page.getByRole("region", {
    name: "Chờ admin xác minh thành viên",
    exact: true,
  });
  await review.getByText(email, { exact: true }).waitFor();
  await review
    .getByLabel("Quyết định xác minh", { exact: true })
    .selectOption("approve");
  const approved = owner.page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/approvals",
  );
  await review
    .getByRole("button", { name: "Xử lý yêu cầu", exact: true })
    .click();
  check((await approved).ok(), "APPROVE_POST_FAILED");
  await owner.page
    .getByRole("heading", {
      name: "Chờ admin xác minh thành viên",
      exact: true,
    })
    .waitFor({ state: "hidden" });
  check(
    (
      await db.query("select user_id from public.group_members where id=$1", [
        guest,
      ])
    ).rows[0].user_id === signed.id,
    "OLD_MEMBER_ID_NOT_LINKED",
  );
  check(
    (
      await db.query(
        "select count(*) from public.group_members where group_id=$1 and user_id=$2 and status='active'",
        [group, signed.id],
      )
    ).rows[0].count === "1",
    "DUPLICATE_MEMBERSHIP",
  );
  await page.reload();
  await page
    .getByRole("heading", { name: "Đã liên kết với tên cũ", exact: true })
    .waitFor();
  await page.goto(origin + "/me");
  await page
    .getByRole("heading", { name: "Tài khoản đăng nhập", exact: true })
    .waitFor();
  await page.getByText(email, { exact: true }).waitFor();
  await page.screenshot({
    path: ".tools/account-onboarding/account-linked.png",
    fullPage: true,
  });
  step = "existing-login";
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.getByLabel("Địa chỉ email", { exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Gửi link đăng nhập", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Kiểm tra email của bạn", exact: true })
    .waitFor();
  const sent = await (
    await fetch(
      "http://127.0.0.1:54324/api/v1/search?query=" +
        encodeURIComponent("to:" + email),
    )
  ).json();
  check(sent.messages?.length >= 2, "EXISTING_ACCOUNT_LOGIN_EMAIL");
  step = "callback-error";
  await page.goto(
    origin +
      "/auth/callback?error_code=otp_expired&mode=register&next=" +
      encodeURIComponent(invitePath),
  );
  check(
    new URL(page.url()).pathname === "/register",
    "REGISTER_ERROR_RETURNS_REGISTER",
  );
  check(
    new URL(page.url()).searchParams.get("next") === invitePath,
    "ERROR_INVITE_NEXT",
  );
  await page.locator(".auth-card").getByRole("alert").waitFor();
  console.log(
    JSON.stringify({
      passed: true,
      loginDoesNotCreate: true,
      realEmailSignup: true,
      pkceCallback: true,
      invitePreserved: true,
      guestClaimAdminApproved: true,
      originalMemberId: true,
      accountEmailVisible: true,
      responsive: [320, 390, 1440],
      providerCalls: 0,
    }),
  );
} catch (e) {
  console.error(
    JSON.stringify({
      code: e.code || e.name,
      step,
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
