import { randomUUID } from "node:crypto";
import { localBrowser, check } from "./local-browser.mjs";
let app;
try {
  const email = `first-group-${randomUUID()}@3t.test`;
  process.env.SUPER_ADMIN_EMAILS = email;
  app = await localBrowser(3224, ".tools/first-group", { production: true });
  const { db, origin } = app;
  const owner = await app.login(email);
  await db.query(
    "insert into app_private.super_admin_allowlist(email) values($1)",
    [email],
  );
  await owner.page.goto(origin);
  await owner.page.waitForURL(origin + "/groups");
  await owner.page
    .getByRole("heading", { name: "Tạo nhóm mới", exact: true })
    .waitFor();
  await owner.page
    .getByLabel("Tên nhóm", { exact: true })
    .fill("First group UI fixture");
  await owner.page
    .getByRole("button", { name: "Tạo nhóm", exact: true })
    .click();
  await owner.page.waitForURL(/\/groups\/[a-f0-9-]{36}$/);
  await owner.page
    .getByRole("heading", { name: "Mời bạn", exact: true })
    .waitFor();
  const group = new URL(owner.page.url()).pathname.split("/").pop();
  check(
    (
      await db.query(
        "select role from public.group_members where group_id=$1 and user_id=$2 and status='active'",
        [group, owner.user.id],
      )
    ).rows[0]?.role === "admin",
    "CREATOR_BECOMES_GROUP_ADMIN",
  );
  await owner.page
    .getByRole("button", { name: "Tạo link mời", exact: true })
    .click();
  await owner.page.locator('a[href*="/join/"]').waitFor();
  await owner.page
    .getByText("Thêm người chưa có tài khoản", { exact: true })
    .click();
  await owner.page
    .getByLabel("Tên thành viên", { exact: true })
    .fill("Guest fixture");
  await owner.page
    .getByRole("button", { name: "Thêm thành viên", exact: true })
    .click();
  await owner.page
    .getByText("Guest fixture", { exact: true })
    .first()
    .waitFor();
  await owner.page.screenshot({
    path: ".tools/first-group/created.png",
    fullPage: true,
    caret: "initial",
  });
  console.log(
    JSON.stringify({
      passed: true,
      localOnly: true,
      firstGroupCreatedThroughUI: true,
      creatorIsAdmin: true,
      inviteCreated: true,
      guestAdded: true,
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ code: error.code || error.name }));
  process.exitCode = 1;
} finally {
  await app?.close();
}
