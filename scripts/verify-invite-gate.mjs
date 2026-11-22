import { randomUUID, randomBytes, createHash } from "node:crypto";
import { localBrowser, check } from "./local-browser.mjs";
let app,
  step = "start";
try {
  app = await localBrowser(3222, ".tools/invite-gate");
  const { origin, db } = app;
  const owner = await app.login("invite-owner@3t.test");
  // A fresh identity makes this suite repeatable after prior successful joins.
  const newcomer = await app.login(`new-${randomUUID()}@3t.test`);
  const group = randomUUID();
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Invite gate fixture','Test',$2)",
    [group, owner.user.id],
  );
  await db.query(
    "insert into public.group_members(group_id,user_id,display_name,role) values($1,$2,'Owner','admin')",
    [group, owner.user.id],
  );
  step = "locked";
  for (const path of [
    "/",
    "/sessions",
    "/sessions/new",
    "/debts",
    "/groups",
    "/me",
    "/polls",
    "/approvals",
    "/ai",
    "/notifications",
    `/groups/${group}`,
  ]) {
    await newcomer.page.goto(origin + path);
    await newcomer.page.waitForURL(origin + "/welcome");
    await newcomer.page
      .getByRole("heading", { name: "Chờ lời mời từ nhóm bạn", exact: true })
      .waitFor();
    check(
      (await newcomer.page.getByRole("navigation").count()) === 0,
      "NO_FEATURE_NAV_FOR_NEWCOMER",
    );
    check(
      (await newcomer.page.getByRole("link").count()) === 0,
      "NO_FEATURE_LINKS_FOR_NEWCOMER",
    );
  }
  const denied = await newcomer.context.request.post(origin + "/api/ai/chat", {
    data: { groupId: group, message: "test" },
  });
  check(denied.status() === 403, "NON_MEMBER_API_DENIED");
  const direct = await newcomer.client.rpc("session_details", {
    sid: randomUUID(),
  });
  check(direct.error?.code === "P0001", "DIRECT_RPC_NON_MEMBER_DENIED");
  for (const width of [320, 390, 1440]) {
    await newcomer.page.setViewportSize({ width, height: 900 });
    check(
      await newcomer.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "WELCOME_OVERFLOW",
    );
    await newcomer.page.screenshot({
      path: `.tools/invite-gate/welcome-${width}.png`,
      fullPage: true,
      caret: "initial",
    });
  }
  step = "invalid-invite";
  await newcomer.page.goto(origin + "/join/" + "0".repeat(64));
  await newcomer.page
    .getByLabel("Tên trong nhóm", { exact: true })
    .fill("New member");
  await newcomer.page
    .getByRole("button", { name: "Tham gia nhóm", exact: true })
    .click();
  await newcomer.page.getByRole("alert").waitFor();
  check(
    (
      await db.query(
        "select count(*) from public.group_members where user_id=$1 and status='active'",
        [newcomer.user.id],
      )
    ).rows[0].count === "0",
    "INVALID_INVITE_CANNOT_UNLOCK",
  );
  step = "valid-invite";
  const token = randomBytes(32).toString("hex");
  const invite = await owner.client.rpc("create_invite", {
    g: group,
    hashed_token: createHash("sha256").update(token).digest("hex"),
    valid_until: new Date(Date.now() + 3600000).toISOString(),
    use_limit: 1,
  });
  check(!invite.error, "CREATE_INVITE_FAILED");
  await newcomer.page.goto(origin + "/join/" + token);
  await newcomer.page
    .getByLabel("Tên trong nhóm", { exact: true })
    .fill("New member");
  await newcomer.page
    .getByRole("button", { name: "Tham gia nhóm", exact: true })
    .click();
  await newcomer.page.waitForURL(origin + "/groups/" + group);
  await newcomer.page.goto(origin);
  await newcomer.page.setViewportSize({ width: 390, height: 844 });
  await newcomer.page.getByRole("heading", { name: /Chào / }).waitFor();
  await newcomer.page
    .getByRole("navigation", { name: "Điều hướng điện thoại" })
    .waitFor();
  check(
    (await newcomer.page
      .getByRole("link", { name: "Tạo buổi chơi", exact: true })
      .count()) === 1,
    "ONE_PRIMARY_CREATE_ACTION",
  );
  for (const width of [320, 390, 768, 1440]) {
    await newcomer.page.setViewportSize({ width, height: 900 });
    check(
      await newcomer.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "MEMBER_HOME_OVERFLOW",
    );
    await newcomer.page.screenshot({
      path: `.tools/invite-gate/home-${width}.png`,
      fullPage: true,
      caret: "initial",
    });
  }
  await newcomer.page
    .getByRole("button", { name: "Bật giao diện tối", exact: true })
    .click();
  await newcomer.page.reload();
  await newcomer.page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  step = "removed";
  const member = (
    await db.query(
      "select id from public.group_members where group_id=$1 and user_id=$2",
      [group, newcomer.user.id],
    )
  ).rows[0];
  check(
    !(
      await owner.client.rpc("manage_member", {
        g: group,
        target: member.id,
        operation: "remove",
        label: null,
      })
    ).error,
    "REMOVE_FAILED",
  );
  await newcomer.page.goto(origin + "/me");
  await newcomer.page.waitForURL(origin + "/welcome");
  await newcomer.page
    .getByRole("button", { name: "Đăng xuất", exact: true })
    .click();
  await newcomer.page.waitForURL(origin + "/login");
  console.log(
    JSON.stringify({
      passed: true,
      nonMemberOnePage: true,
      directUrlsDenied: 11,
      apiDenied: true,
      invalidInviteDenied: true,
      validInviteUnlocks: true,
      removedMemberLockedAgain: true,
      logoutAvailable: true,
      responsive: true,
      darkModePersists: true,
      providerCalls: 0,
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ code: error.code || error.name, step }));
  process.exitCode = 1;
} finally {
  await app?.close();
}
