import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { localBrowser, check } from "./local-browser.mjs";
import { setRsvp } from "./ui-helpers.mjs";
let app,
  step = "setup";
try {
  app = await localBrowser(3227, ".tools/meeting-ui");
  const { db, origin } = app;
  step = "empty-calendar";
  const empty = await app.login(`empty-calendar-${randomUUID()}@3t.test`);
  const emptyGroup = randomUUID();
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Lịch trống','Cầu lông',$2)",
    [emptyGroup, empty.user.id],
  );
  await db.query(
    "insert into public.group_members(group_id,user_id,display_name) values($1,$2,'Thành viên mới')",
    [emptyGroup, empty.user.id],
  );
  await empty.page.goto(origin + "/sessions");
  await expect(
    empty.page.getByRole("tab", { name: "Lịch tháng", exact: true }),
  ).toBeVisible();
  await expect(empty.page.locator(".calendar-card")).toBeVisible();
  await expect(
    empty.page.getByText(
      "Chưa có buổi chơi. Tạo buổi đầu tiên để hiện trên lịch.",
      { exact: true },
    ),
  ).toBeVisible();
  const actors = await Promise.all(
    ["admin", "creator", "collector"].map((name) =>
      app.login(`meeting-${name}@3t.test`),
    ),
  );
  const group = randomUUID();
  const names = ["Quản trị lịch", "Người tạo lịch", "Người tính tiền"];
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Lịch nhóm thử nghiệm','Cầu lông',$2)",
    [group, actors[0].user.id],
  );
  for (const [i, actor] of actors.entries()) {
    await db.query(
      "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,$2,'970436','TEST0001','TEST') on conflict(id) do update set bank_bin=excluded.bank_bin,bank_account_no=excluded.bank_account_no,bank_account_name=excluded.bank_account_name",
      [actor.user.id, names[i]],
    );
    await db.query(
      "insert into public.group_members(group_id,user_id,display_name,role) values($1,$2,$3,$4)",
      [group, actor.user.id, names[i], i === 0 ? "admin" : "member"],
    );
  }
  await db.query(
    "update public.profiles set bank_bin=null,bank_account_no=null,bank_account_name=null where id=$1",
    [actors[1].user.id],
  );
  const page = actors[1].page;
  step = "member-group-invitation";
  await page.goto(origin + "/groups/" + group);
  await page.getByRole("button", { name: "Tạo link mời", exact: true }).click();
  await expect(page.locator('a[href*="/join/"]')).toBeVisible();
  step = "meeting-composer";
  await page.goto(origin + "/sessions/new");
  await page.getByLabel("Nhóm", { exact: true }).selectOption(group);
  await expect(
    page.getByRole("heading", { name: "Tạo buổi chơi", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Tên buổi", { exact: true })).toHaveValue(
    /Lịch nhóm thử nghiệm/,
  );
  await page
    .getByLabel("Tên buổi", { exact: true })
    .fill("Buổi có lời mời và xác nhận");
  await page.getByLabel("Địa điểm", { exact: true }).fill("Sân thử nghiệm");
  const start = page.getByLabel("Bắt đầu", { exact: true }),
    end = page.getByLabel("Kết thúc", { exact: true });
  const original = await start.inputValue();
  const changed = "19:00";
  await start.fill(changed);
  await expect(end).toHaveValue("21:00");
  check(original === "18:00", "DEFAULT_START_TIME");
  await page.getByRole("button", { name: "Mời cả nhóm", exact: true }).click();
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: `.tools/meeting-ui/composer-${width}.png`,
      fullPage: true,
    });
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll("main *")]
        .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
        .map((el) => ({
          tag: el.tagName,
          class: el.className,
          width: Math.round(el.getBoundingClientRect().width),
        }))
        .slice(0, 12),
    );
    if (overflow.length) console.log(JSON.stringify({ width, overflow }));
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "NO_PAGE_OVERFLOW",
    );
  }
  await page.getByRole("button", { name: "Tạo lịch", exact: true }).click();
  await page.waitForURL(/\/sessions\/[a-f0-9-]{36}$/);
  const sid = new URL(page.url()).pathname.split("/").at(-1);
  step = "created-meeting-visible-on-calendar";
  await page.goto(origin + "/sessions");
  await expect(page.locator(".calendar-card")).toBeVisible();
  await expect(page.locator(`a[href="/sessions/${sid}"]`)).toBeVisible();
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    check(
      await page
        .locator(".agenda-row")
        .first()
        .evaluate((el) => el.getBoundingClientRect().top < 500),
      "AGENDA_VISIBLE_WITHOUT_SCROLLING",
    );
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "AGENDA_NO_HORIZONTAL_OVERFLOW",
    );
  }
  await page.locator(`a[href="/sessions/${sid}"]`).click();
  check(
    (
      await db.query(
        "select member_id from public.session_attendees where session_id=$1 and rsvp='going'",
        [sid],
      )
    ).rowCount === 0,
    "INVITATION_IS_NOT_CONSENT",
  );
  step = "outside-member-invitation";
  await page
    .getByRole("button", { name: "Mời thêm người tham gia", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Tạo link mời bạn mới vào buổi", exact: true })
    .click();
  const link = page.locator('a[href*="/join/"][href*="?session="]');
  await expect(link).toBeVisible();
  const invite = await link.getAttribute("href");
  await page.keyboard.press("Escape");
  const newcomer = await app.login("meeting-newcomer@3t.test");
  await newcomer.page.goto(invite);
  await newcomer.page
    .getByLabel("Tên trong nhóm", { exact: true })
    .fill("Bạn mới được mời");
  await newcomer.page
    .getByRole("button", { name: "Tham gia nhóm", exact: true })
    .click();
  await newcomer.page.waitForURL("**/sessions/" + sid);
  check(
    (
      await db.query(
        "select a.member_id from public.session_attendees a join public.group_members m on m.id=a.member_id where a.session_id=$1 and m.user_id=$2 and a.rsvp='going'",
        [sid, newcomer.user.id],
      )
    ).rowCount === 0,
    "JOINING_GROUP_DOES_NOT_ACCEPT_SESSION",
  );
  step = "self-rsvp";
  await setRsvp(page);
  step = "rsvp-network-rollback";
  const interruptRsvp = async (route) => {
    if (route.request().method() === "POST") await route.abort("failed");
    else await route.continue();
  };
  await page.route("**/sessions/" + sid, interruptRsvp);
  await page.getByRole("button", { name: "Không đi", exact: true }).click();
  await expect(page.locator(".rsvp-control").getByRole("alert")).toHaveText(
    "Chưa nhận được kết quả. Kiểm tra kết nối và thử lại.",
  );
  await expect(
    page.getByRole("button", { name: "Tham gia", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  check(
    (
      await db.query(
        "select a.rsvp from public.session_attendees a join public.group_members m on m.id=a.member_id where a.session_id=$1 and m.user_id=$2",
        [sid, actors[1].user.id],
      )
    ).rows[0].rsvp === "going",
    "FAILED_RSVP_PRESERVES_SAVED_CHOICE",
  );
  await page.unroute("**/sessions/" + sid, interruptRsvp);
  step = "list-overview-and-direct-rsvp";
  await page.goto(origin + "/sessions");
  const row = page
    .locator(".agenda-row")
    .filter({ has: page.locator(`a[href="/sessions/${sid}"]`) });
  await expect(
    row.getByRole("button", { name: "1 đi · Đã nhận lời", exact: true }),
  ).toBeVisible();
  await expect(
    row.getByRole("button", { name: "2 chờ · Chờ trả lời", exact: true }),
  ).toBeVisible();
  const listSave = page.waitForResponse((r) => r.request().method() === "POST");
  await row.getByRole("button", { name: "Không đi", exact: true }).click();
  await listSave;
  await expect(
    row.getByRole("group", { name: "Tôi tham gia" }),
  ).toHaveAttribute("aria-busy", "false");
  await page.goto(origin + "/sessions/" + sid);
  await expect(
    page.getByRole("button", { name: "Không đi", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await setRsvp(page);
  step = "withdrawal";
  await setRsvp(page, false);
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "select rsvp from public.session_attendees a join public.group_members m on m.id=a.member_id where session_id=$1 and user_id=$2",
            [sid, actors[1].user.id],
          )
        ).rows[0].rsvp,
    )
    .toBe("not_going");
  await setRsvp(page);
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "select rsvp from public.session_attendees a join public.group_members m on m.id=a.member_id where session_id=$1 and user_id=$2",
            [sid, actors[1].user.id],
          )
        ).rows[0].rsvp,
    )
    .toBe("going");
  step = "claim-collector";
  const collector = actors[2].page;
  await collector.goto(origin + "/sessions/" + sid);
  await setRsvp(collector);
  await collector
    .getByRole("button", { name: "Gán cho tôi", exact: true })
    .click();
  await expect(
    collector.getByRole("heading", {
      name: "Chi phí buổi chơi",
      exact: true,
    }),
  ).toBeVisible();
  step = "finalize";
  await collector
    .getByRole("button", { name: "Nhập phí và chốt buổi", exact: true })
    .click();
  await collector.getByLabel("Tiền sân (đ)", { exact: true }).fill("100000");
  await collector
    .getByRole("button", { name: "Tôi đã xem bảng chia", exact: true })
    .click();
  await collector
    .getByRole("button", {
      name: "Chốt toàn bộ chi phí",
      exact: true,
    })
    .click();
  await expect(collector.locator(".booking-lock")).toBeVisible();
  check(
    (
      await db.query(
        "select amount::text from public.settlements where session_id=$1 and status='pending'",
        [sid],
      )
    ).rows[0].amount === "50000",
    "ONLY_ACCEPTED_PEOPLE_PAY",
  );
  step = "locked-permissions";
  for (const actor of actors.slice(0, 2)) {
    await actor.page.goto(origin + "/sessions/" + sid);
    await expect(actor.page.locator(".booking-lock")).toBeVisible();
    await expect(
      actor.page.getByRole("group", { name: "Tôi tham gia", exact: true }),
    ).toHaveCount(0);
    await expect(
      actor.page.getByText("Thêm khoản chi hoặc giảm giá", { exact: true }),
    ).toHaveCount(0);
    await expect(
      actor.page.getByText("Sửa thông tin buổi", { exact: true }),
    ).toHaveCount(0);
    const denied = await actor.client.rpc("set_rsvp", { sid, going: false });
    check(!!denied.error, "DIRECT_RSVP_LOCKED");
  }
  await expect(
    collector.getByText("Thêm khoản chi hoặc giảm giá", { exact: true }),
  ).toBeVisible();
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "member invitations",
        "meeting composer at 360/1440",
        "time duration",
        "self RSVP and withdrawal",
        "network rollback",
        "direct RSVP from agenda",
        "collector claim",
        "finalization lock",
        "collector-only invoice UI",
      ],
      fixture: "local only",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      step,
      code: error.code || error.message?.slice(0, 500) || "UNKNOWN",
    }),
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
