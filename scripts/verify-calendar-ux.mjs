import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { localBrowser, check } from "./local-browser.mjs";
let app,
  step = "setup";
const shift = (day, n) =>
  new Date(Date.parse(day + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
try {
  app = await localBrowser(3231, ".tools/calendar-ux");
  const { db, origin } = app;
  const actor = await app.login(`calendar-${randomUUID()}@3t.test`);
  const { page } = actor;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const group = randomUUID(),
    members = Array.from({ length: 5 }, () => randomUUID());
  const names = [
    "An UX",
    "Bình UX",
    "Chi đã rút",
    "Dũng không đi",
    "Em chưa chốt",
  ];
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Nhóm UX','Cầu lông',$2)",
    [group, actor.user.id],
  );
  for (let i = 0; i < members.length; i++)
    await db.query(
      "insert into public.group_members(id,group_id,user_id,display_name) values($1,$2,$3,$4)",
      [members[i], group, i === 0 ? actor.user.id : null, names[i]],
    );
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const joined = shift(today, 1),
    confirmed = shift(today, 2),
    voting = shift(today, 3),
    expired = shift(today, 4);
  async function session(title, day, status = "planned", hour = 18) {
    const sid = randomUUID(),
      start = `${day}T${hour}:00:00+07:00`;
    await db.query(
      "insert into public.sessions(id,group_id,title,venue,starts_at,ends_at,commit_deadline,status,created_by) values($1,$2,$3,'Sân UX',$4::timestamptz,$4::timestamptz+interval '1 hour',$4,$5,$6)",
      [sid, group, title, start, status, actor.user.id],
    );
    return sid;
  }
  const mine = await session("Buổi tôi tham gia", joined, "planned", 17);
  const closed = await session("Lịch nhóm đã chốt", confirmed);
  const cancelled = await session("Buổi đã hủy", expired, "cancelled");
  for (const [i, member] of members.entries())
    await db.query(
      "insert into public.session_attendees(session_id,member_id,rsvp,committed_at,removed_at) values($1,$2,$3,case when $4 then now() else null end,case when $5 then now() else null end)",
      [
        mine,
        member,
        i === 1 ? "none" : i === 3 ? "not_going" : "going",
        i !== 1 && i !== 4,
        i === 2,
      ],
    );
  await db.query(
    "insert into public.session_attendees(session_id,member_id,rsvp,committed_at) values($1,$2,'going',now())",
    [cancelled, members[0]],
  );
  for (let i = 0; i < 36; i++)
    await session(`Buổi để kiểm tra cuộn ${i}`, joined, "planned", 19);
  for (let i = 5; i < 30; i++) {
    const member = randomUUID();
    members.push(member);
    await db.query(
      "insert into public.group_members(id,group_id,display_name) values($1,$2,$3)",
      [
        member,
        group,
        `Thành viên kiểm tra với tên dài số ${i} trong nhóm thể thao 3T`,
      ],
    );
  }
  const large = await session("Buổi nhóm 30 người", joined, "planned", 20);
  for (const member of members)
    await db.query(
      "insert into public.session_attendees(session_id,member_id,rsvp) values($1,$2,'none')",
      [large, member],
    );
  async function poll(title, day, status, result = null, future = true) {
    const id = randomUUID();
    await db.query(
      "insert into public.polls(id,group_id,title,venue,min_attendees,closes_at,status,resulting_session_id,created_by) values($1,$2,$3,'Sân UX',2,now()+($4::int*interval '1 day'),$5,$6,$7)",
      [id, group, title, future ? 1 : -1, status, result, actor.user.id],
    );
    for (const hour of [18, 20])
      await db.query(
        "insert into public.poll_options(poll_id,starts_at,ends_at) values($1,$2::timestamptz,$2::timestamptz+interval '1 hour')",
        [id, `${day}T${hour}:00:00+07:00`],
      );
    return id;
  }
  await poll("Thăm dò đã chốt", confirmed, "closed", closed);
  const activePoll = await poll("Nhóm đang chọn giờ", voting, "open");
  await poll("Vote đã hết hạn", expired, "open", null, false);
  const hiddenGroup = randomUUID(),
    hiddenMember = randomUUID(),
    hiddenPoll = randomUUID();
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Nhóm đã rời','Test',$2)",
    [hiddenGroup, actor.user.id],
  );
  await db.query(
    "insert into public.group_members(id,group_id,user_id,display_name,status) values($1,$2,$3,'Tên riêng không được đọc','removed')",
    [hiddenMember, hiddenGroup, actor.user.id],
  );
  await db.query(
    "insert into public.sessions(group_id,title,venue,starts_at,commit_deadline,created_by) values($1,'Lịch nhóm đã rời','Sân riêng',$2,$2,$3)",
    [hiddenGroup, `${joined}T18:00:00+07:00`, actor.user.id],
  );
  await db.query(
    "insert into public.polls(id,group_id,title,venue,min_attendees,closes_at,created_by) values($1,$2,'Thăm dò nhóm đã rời','Sân riêng',2,now()+interval '1 day',$3)",
    [hiddenPoll, hiddenGroup, actor.user.id],
  );
  await db.query(
    "insert into public.poll_options(poll_id,starts_at,ends_at) values($1,$2::timestamptz,$2::timestamptz+interval '1 hour')",
    [hiddenPoll, `${voting}T18:00:00+07:00`],
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + "/sessions");
  await expect(page.locator(".agenda-items")).toBeVisible();
  step = "calendar-statuses";
  async function showMonth(day) {
    const label = `Tháng ${Number(day.slice(5, 7))}/${day.slice(0, 4)}`;
    for (
      let n = 0;
      n < 2 &&
      (await page.locator(".calendar-heading strong").innerText()) !== label;
      n++
    )
      await page
        .getByRole("button", { name: "Tháng sau", exact: true })
        .click();
  }
  await showMonth(joined);
  await expect(
    page.locator(`.calendar [data-date="${joined}"]`),
  ).toHaveAttribute("data-calendar-states", /joined/);
  await showMonth(confirmed);
  await expect(
    page.locator(`.calendar [data-date="${confirmed}"]`),
  ).toHaveAttribute("data-calendar-states", /confirmed/);
  await showMonth(voting);
  await expect(
    page.locator(`.calendar [data-date="${voting}"]`),
  ).toHaveAttribute("aria-label", /1 thăm dò đang vote/);
  await showMonth(expired);
  await expect(
    page.locator(`.calendar [data-date="${expired}"]`),
  ).toHaveAttribute("data-calendar-states", "");
  await expect(page.getByText("Vote đã hết hạn", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: "Lịch nhóm đã rời", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Thăm dò nhóm đã rời", exact: true }),
  ).toHaveCount(0);
  step = "hover-focus-roster";
  const row = page
    .locator(".agenda-row")
    .filter({ has: page.locator(`a[href="/sessions/${mine}"]`) });
  const going = row.getByRole("button", {
    name: "1 đi · Đã nhận lời",
    exact: true,
  });
  const pending = row.getByRole("button", {
    name: "2 chờ · Chờ trả lời",
    exact: true,
  });
  await going.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Đã nhận lời: An UX");
  await pending.hover();
  await expect(page.getByRole("tooltip")).toContainText("Bình UX");
  await expect(page.getByRole("tooltip")).toContainText("Em chưa chốt");
  await expect(page.getByRole("tooltip")).not.toContainText("Chi đã rút");
  const hoverBubble = await page.getByRole("tooltip").boundingBox();
  await page.mouse.move(
    hoverBubble.x + hoverBubble.width / 2,
    hoverBubble.y + 15,
    { steps: 10 },
  );
  await expect(page.getByRole("tooltip")).toHaveAttribute("data-show", "true");
  await going.focus();
  await expect(page.getByRole("tooltip")).toHaveText("Đã nhận lời: An UX");
  await going.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  step = "scroll-ownership";
  const before = await page.locator(".calendar-card").boundingBox();
  await page.locator(".agenda-items").hover();
  await page.mouse.wheel(0, 1200);
  await expect
    .poll(() => page.locator(".agenda-items").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(500);
  const after = await page.locator(".calendar-card").boundingBox();
  check(Math.abs(before.y - after.y) < 1, "CALENDAR_STAYS_FIXED");
  check(
    await page.evaluate(
      () =>
        window.scrollY === 0 &&
        document.scrollingElement.scrollHeight <= innerHeight + 1 &&
        document.getElementById("main-content").scrollTop === 0,
    ),
    "NO_DOCUMENT_OR_PARENT_SCROLL",
  );
  await page.locator(".agenda-items").focus();
  await page.locator(".agenda-items").press("Home");
  await expect
    .poll(() => page.locator(".agenda-items").evaluate((el) => el.scrollTop))
    .toBe(0);
  await page.screenshot({
    path: ".tools/calendar-ux/desktop.png",
    animations: "disabled",
  });
  step = "poll-day-filter";
  await showMonth(voting);
  await page.locator(`.calendar [data-date="${voting}"]`).click();
  await expect(page.locator(".poll-agenda-item")).toHaveCount(2);
  await expect(
    page
      .locator(".poll-agenda-item")
      .first()
      .locator(`a[href="/polls/${activePoll}"]`)
      .first(),
  ).toBeVisible();
  await expect(
    page.locator(".agenda-items .agenda-row:not(.poll-agenda-item)"),
  ).toHaveCount(0);
  step = "mobile-touch";
  const touchContext = await actor.context
    .browser()
    .newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await touchContext.addCookies(await actor.context.cookies());
  const mobile = await touchContext.newPage();
  await mobile.goto(origin + "/sessions");
  await expect(mobile.locator(".week-days")).toBeVisible();
  for (
    let i = 0;
    i < 2 &&
    !(await mobile.locator(`.week-days [data-date="${joined}"]`).count());
    i++
  )
    await mobile.getByRole("button", { name: "Tuần sau", exact: true }).tap();
  await expect(
    mobile.locator(`.week-days [data-date="${joined}"]`),
  ).toHaveAttribute("data-calendar-states", /joined/);
  const mobileRow = mobile
    .locator(".agenda-row")
    .filter({ has: mobile.locator(`a[href="/sessions/${mine}"]`) });
  await mobileRow
    .getByRole("button", { name: "2 chờ · Chờ trả lời", exact: true })
    .tap();
  await expect(mobile.getByRole("tooltip")).toContainText("Bình UX");
  const bubble = await mobile.getByRole("tooltip").boundingBox();
  check(
    bubble.x >= 0 &&
      bubble.x + bubble.width <= 390 &&
      bubble.y >= 0 &&
      bubble.y + bubble.height <= 844,
    "TOUCH_PREVIEW_INSIDE_VIEWPORT",
  );
  await mobile.getByRole("heading", { name: "Buổi chơi", exact: true }).tap();
  await expect(mobile.getByRole("tooltip")).toHaveCount(0);
  await mobile
    .getByRole("button", { name: "Xem lịch tháng", exact: true })
    .tap();
  await expect(mobile.locator(".month-calendar")).toBeVisible();
  await mobile.locator(".calendar").press("Escape");
  await expect(mobile.locator(".month-calendar")).toBeHidden();
  await mobile.screenshot({
    path: ".tools/calendar-ux/mobile.png",
    animations: "disabled",
  });
  check(
    await mobile.evaluate(
      () =>
        window.scrollY === 0 &&
        document.scrollingElement.scrollHeight <= innerHeight + 1 &&
        document.documentElement.scrollWidth <= innerWidth,
    ),
    "MOBILE_HAS_ONE_SCROLL_REGION",
  );
  step = "long-roster-and-short-viewport";
  await mobile.setViewportSize({ width: 360, height: 600 });
  const largeRow = mobile
    .locator(".agenda-row")
    .filter({ has: mobile.locator(`a[href="/sessions/${large}"]`) });
  await largeRow
    .getByRole("button", { name: "30 chờ · Chờ trả lời", exact: true })
    .tap();
  await expect(mobile.getByRole("tooltip")).toContainText(
    "Thành viên kiểm tra với tên dài số 29",
  );
  const longBubble = await mobile.getByRole("tooltip").boundingBox();
  check(
    longBubble.x >= 0 &&
      longBubble.x + longBubble.width <= 360 &&
      longBubble.y >= 0 &&
      longBubble.y + longBubble.height <= 600,
    "LONG_ROSTER_FITS_SMALL_SCREEN",
  );
  check(
    await mobile
      .getByRole("tooltip")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
    "ONLY_LONG_ROSTER_SCROLLS_INSIDE_PREVIEW",
  );
  await mobile.emulateMedia({ reducedMotion: "reduce" });
  check(
    await mobile.getByRole("tooltip").evaluate((el) =>
      getComputedStyle(el)
        .transitionDuration.split(",")
        .every((value) => parseFloat(value) === 0),
    ),
    "ROSTER_RESPECTS_REDUCED_MOTION",
  );
  step = "long-page-scroll";
  await page.goto(origin + "/sessions/new");
  await expect(page.locator(".meeting-editor")).toBeVisible();
  await page.locator(".session-workspace-body").hover();
  await page.mouse.wheel(0, 1200);
  await expect
    .poll(() =>
      page.locator(".session-workspace-body").evaluate((el) => el.scrollTop),
    )
    .toBeGreaterThan(0);
  check(
    await page.evaluate(
      () =>
        window.scrollY === 0 &&
        document.scrollingElement.scrollHeight <= innerHeight + 1 &&
        document.querySelector(".app-header").getBoundingClientRect().top === 0,
    ),
    "FORMS_USE_MODAL_NOT_DOCUMENT",
  );
  check(errors.length === 0, "NO_CLIENT_ERRORS");
  console.log(
    JSON.stringify({
      ok: true,
      localOnly: true,
      providerCalls: 0,
      checks: [
        "personal/confirmed/voting calendar markers",
        "expired and cancelled excluded",
        "polls visible by date",
        "names on hover/focus/touch",
        "withdrawn and uncommitted names",
        "Escape and outside dismissal",
        "fixed calendar and navigation",
        "independent agenda scrolling",
        "mobile month overlay",
      ],
    }),
  );
  await touchContext.close();
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      step,
      code: error.code || error.message?.slice(0, 1000) || "UNKNOWN",
    }),
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
