import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { localBrowser, check } from "./local-browser.mjs";
let app,
  testPage,
  step = "setup";
try {
  app = await localBrowser(3236, ".tools/overview-ui");
  const { db, origin } = app;
  const run = randomUUID();
  const owner = await app.login(`overview-owner-${run}@3t.test`);
  const peer = await app.login(`overview-peer-${run}@3t.test`);
  const outside = await app.login(`overview-outside-${run}@3t.test`);
  const page = (testPage = owner.page);
  const g = randomUUID(),
    other = randomUUID(),
    a = randomUUID(),
    b = randomUUID();
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Overview browser fixture','Cầu lông',$2),($3,'Private overview fixture','Sport',$4)",
    [g, owner.user.id, other, outside.user.id],
  );
  await db.query(
    "insert into public.group_members(id,group_id,user_id,display_name,role) values($1,$2,$3,'An','admin'),($4,$2,$5,'Bình','member')",
    [a, g, owner.user.id, b, peer.user.id],
  );
  await db.query(
    "insert into public.group_members(group_id,user_id,display_name,role) values($1,$2,'Outside','admin')",
    [other, outside.user.id],
  );
  for (let i = 0; i < 36; i++) {
    const sid = randomUUID();
    await db.query(
      "insert into public.sessions(id,group_id,title,venue,starts_at,commit_deadline,status,created_by) values($1,$2,$3,'Sân A',now()-($4*interval '1 day'),now()-($4*interval '1 day'),'played',$5)",
      [sid, g, "Buổi đã chơi " + i, i * 5 + 1, owner.user.id],
    );
    await db.query(
      "insert into public.session_attendees(session_id,member_id,rsvp,committed_at) values($1,$2,$3,case when $4 then now() else null end)",
      [sid, a, i % 4 === 0 ? "not_going" : "going", i % 4 !== 0],
    );
  }
  const future = [];
  for (let i = 0; i < 3; i++) {
    const sid = randomUUID();
    future.push(sid);
    await db.query(
      "insert into public.sessions(id,group_id,title,venue,starts_at,commit_deadline,created_by) values($1,$2,$3,'Sân Trung Tâm',now()+($4*interval '1 day'),now()+($4*interval '1 day'),$5)",
      [
        sid,
        g,
        ["Cầu lông cuối tuần", "Giao lưu cùng nhóm", "Buổi tập kỹ thuật"][i],
        i + 1,
        owner.user.id,
      ],
    );
    await db.query(
      "insert into public.session_attendees(session_id,member_id,rsvp,committed_at) values($1,$2,'going',now()),($1,$3,'none',null)",
      [sid, a, b],
    );
  }
  for (let i = 0; i < 8; i++)
    await db.query(
      "insert into public.notifications(group_id,user_id,event_key,title,href,created_at,read_at) values($1,$2,$3,$4,$5,now()-($6*interval '1 minute'),case when $6>=6 then now() else null end)",
      [
        g,
        owner.user.id,
        randomUUID(),
        "Lời mời chơi cầu lông " + i,
        "/sessions/" + future[0],
        i,
      ],
    );
  await db.query(
    "insert into public.notifications(group_id,user_id,event_key,title,href) values($1,$2,$3,'Private peer notification','/sessions'),($4,$5,$6,'Forbidden group notification','/groups')",
    [g, peer.user.id, randomUUID(), other, owner.user.id, randomUUID()],
  );
  const clientErrors = [];
  page.on("pageerror", (e) => clientErrors.push(e.message));
  step = "bandwidth-payloads";
  const before = await owner.client
    .from("sessions")
    .select(
      "id,title,venue,starts_at,ends_at,status,revision,group:groups(name),attendees:session_attendees(member_id,rsvp,committed_at,removed_at,member:group_members(display_name))",
    );
  const after = await owner.client
    .from("sessions")
    .select(
      "id,title,venue,starts_at,ends_at,status,revision,group:groups(name),attendees:session_attendees(member_id,rsvp,committed_at,removed_at)",
    )
    .eq("status", "planned")
    .gte("starts_at", new Date().toISOString())
    .eq("attendees.member_id", a)
    .is("attendees.removed_at", null)
    .order("starts_at")
    .limit(3);
  check(
    !before.error &&
      !after.error &&
      after.data.length === 3 &&
      after.data.every((s) => s.attendees.length === 1),
    "BOUNDED_HOME_PAYLOAD",
  );
  const payloads = {
    before: Buffer.byteLength(JSON.stringify(before.data)),
    after: Buffer.byteLength(JSON.stringify(after.data)),
  };
  check(payloads.after < payloads.before * 0.15, "HOME_PAYLOAD_REDUCTION");
  let joined = false;
  const activeTopics = new Set();
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/realtime/v1/websocket")) return;
    const decode = (payload) => {
      if (typeof payload !== "string") return {};
      const value = JSON.parse(payload);
      return Array.isArray(value)
        ? { topic: value[2], event: value[3], payload: value[4] }
        : value;
    };
    ws.on("framesent", ({ payload }) => {
      const value = decode(payload);
      if (value.event === "phx_join") activeTopics.add(value.topic);
      if (value.event === "phx_leave") activeTopics.delete(value.topic);
    });
    ws.on("framereceived", ({ payload }) => {
      const value = decode(payload);
      if (
        value.event === "phx_reply" &&
        value.payload?.status === "ok" &&
        value.topic?.includes("3t-visible-updates")
      )
        joined = true;
    });
  });
  const requests = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (
      u.origin === origin &&
      (u.searchParams.has("_rsc") || u.pathname.startsWith("/api/"))
    )
      requests.push(u.pathname + u.search);
  });
  step = "home-statistics";
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + "/");
  await expect(
    page.getByRole("heading", { name: "Nhịp chơi", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Buổi gần đây", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".home-stat").nth(2)).toContainText("27");
  await expect(page.locator(".contribution-day")).toHaveCount(182);
  await expect(page.locator(".activity-summary")).toContainText("27");
  await page.getByRole("tab", { name: "Nhóm", exact: true }).click();
  await expect(page.locator(".activity-summary")).toContainText("36");
  await page.getByRole("tab", { name: "Cá nhân", exact: true }).click();
  const focusedDay = page.locator('.contribution-day[tabindex="0"]');
  await focusedDay.focus();
  await focusedDay.press("ArrowLeft");
  await expect(page.locator(".contribution-grid :focus")).toBeVisible();
  await expect(page.locator(".home-upcoming li")).toHaveCount(3);
  await page.screenshot({ path: ".tools/overview-ui/home-1440.png" });
  step = "bandwidth-idle";
  await expect.poll(() => joined).toBe(true);
  await expect
    .poll(() => requests.includes("/api/notifications/preview?count=1"))
    .toBe(true);
  check(
    !requests.includes("/api/notifications/preview"),
    "BADGE_ONLY_LOADS_COUNT",
  );
  check(activeTopics.size === 1, "ONE_SHARED_REALTIME_CHANNEL");
  await page.waitForTimeout(1000);
  requests.length = 0;
  console.log(JSON.stringify({ step: "idle-window", seconds: 35 }));
  await page.waitForTimeout(35000);
  check(requests.length === 0, "NO_IDLE_REFRESH_OR_POLLING");
  step = "bandwidth-realtime";
  await db.query(
    "update public.sessions set title='Realtime updated session' where id=$1",
    [future[0]],
  );
  await expect(page.locator(".home-upcoming li").first()).toContainText(
    "Realtime updated session",
    { timeout: 12000 },
  );
  check(
    requests.filter((p) => p.startsWith("/?_rsc=")).length === 1,
    "ONE_EVENT_REFRESH",
  );
  const bandwidth = {
    payloads,
    idleSeconds: 35,
    idleRequests: 0,
    sharedChannel: true,
    realtimeRefresh: true,
  };
  writeFileSync(
    ".tools/overview-ui/bandwidth.json",
    JSON.stringify(bandwidth, null, 2) + "\n",
  );
  step = "notification-isolation";
  const response = await page.request.get(
    origin + "/api/notifications/preview",
  );
  check(
    response.headers()["cache-control"].includes("no-store"),
    "PRIVATE_PREVIEW",
  );
  const preview = await response.json();
  const countResponse = await page.request.get(
    origin + "/api/notifications/preview?count=1",
  );
  const count = await countResponse.json();
  check(count.unread === 6 && !("items" in count), "COUNT_ONLY_RESPONSE");
  check(
    preview.unread === 6 && preview.items.length === 6,
    "BOUNDED_UNREAD_COUNT",
  );
  check(
    preview.items.every(
      (n) => !n.title.includes("Private") && !n.title.includes("Forbidden"),
    ),
    "NOTIFICATION_ISOLATION",
  );
  const peerPreview = await (
    await peer.page.request.get(origin + "/api/notifications/preview")
  ).json();
  check(
    peerPreview.unread === 1 &&
      peerPreview.items[0].title === "Private peer notification",
    "PEER_ONLY_SEES_OWN",
  );
  const outsidePreview = await (
    await outside.page.request.get(origin + "/api/notifications/preview")
  ).json();
  check(
    outsidePreview.unread === 0 && outsidePreview.items.length === 0,
    "ADMIN_CANNOT_READ_ANOTHER_USERS_NOTIFICATIONS",
  );
  const anonymous = await fetch(origin + "/api/notifications/preview");
  check(
    anonymous.status === 401 && !("items" in (await anonymous.json())),
    "AUTHENTICATION_REQUIRED",
  );
  const bell = page.getByRole("button", { name: /^Thông báo/ });
  await expect(bell).toHaveAccessibleName("Thông báo · 6 chưa đọc");
  await bell.click();
  const dropdown = page.getByRole("dialog", { name: "Thông báo", exact: true });
  await expect(dropdown).toBeVisible();
  await expect(
    dropdown.getByRole("link", { name: /Xem tất cả/ }),
  ).toBeVisible();
  await page.screenshot({ path: ".tools/overview-ui/notification-1440.png" });
  await page.keyboard.press("Escape");
  await expect(dropdown).toBeHidden();
  await expect(bell).toBeFocused();
  const fullLoads = requests.filter(
    (p) => p === "/api/notifications/preview",
  ).length;
  check(fullLoads === 1, "LAZY_NOTIFICATION_LIST");
  await bell.press("Enter");
  await expect(dropdown).toBeVisible();
  check(
    requests.filter((p) => p === "/api/notifications/preview").length ===
      fullLoads,
    "REOPEN_REUSES_FRESH_DATA",
  );
  await page.getByRole("heading", { level: 1 }).click();
  await expect(dropdown).toBeHidden();
  step = "read-notification";
  await bell.click();
  await dropdown.locator(".notification-preview-list a").first().click();
  await expect(page).toHaveURL(origin + "/sessions/" + future[0]);
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "select read_at from public.notifications where id=$1",
            [preview.items[0].id],
          )
        ).rows[0].read_at,
    )
    .not.toBeNull();
  await page
    .getByRole("button", { name: "Đóng buổi chơi", exact: true })
    .click();
  await expect(page).toHaveURL(origin + "/sessions");
  await page.getByRole("button", { name: /^Thông báo/ }).click();
  await page
    .getByRole("dialog", { name: "Thông báo", exact: true })
    .getByRole("link", { name: /Xem tất cả/ })
    .click();
  await expect(page).toHaveURL(origin + "/notifications");
  await expect(
    page.getByRole("heading", { name: "Thông báo của tôi", exact: true }),
  ).toBeVisible();
  step = "notification-error-retry";
  await page.goto(origin + "/");
  await page.route("**/api/notifications/preview", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page.getByRole("button", { name: /^Thông báo/ }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.unroute("**/api/notifications/preview");
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(
    page.getByRole("dialog").locator(".notification-preview-list li"),
  ).toHaveCount(6);
  await page.keyboard.press("Escape");
  step = "responsive-and-motion";
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".contribution-day")).toHaveCount(
      width <= 600 ? 91 : 182,
    );
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "HOME_NO_OVERFLOW",
    );
    await page.getByRole("button", { name: /^Thông báo/ }).click();
    const box = await page
      .getByRole("dialog", { name: "Thông báo", exact: true })
      .boundingBox();
    check(
      box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 844,
      "DROPDOWN_IN_VIEWPORT",
    );
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".tools/overview-ui/home-390.png" });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.getByRole("button", { name: /^Thông báo/ }).click();
  await expect(page.locator(".notification-dropdown")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await page.screenshot({
    path: ".tools/overview-ui/notification-390-dark.png",
  });
  await page.keyboard.press("Escape");
  step = "single-calendar";
  await page.goto(origin + "/sessions");
  await expect(page.locator(".agenda-items")).toBeVisible();
  await expect(
    page.getByRole("tablist", { name: "Cách xem buổi chơi" }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".calendar-card")).toBeVisible();
  await expect(page.locator(".session-agenda")).toBeVisible();
  await page.screenshot({ path: ".tools/overview-ui/calendar-1440.png" });
  check(clientErrors.length === 0, "NO_CLIENT_ERRORS");
  console.log(
    JSON.stringify({
      passed: true,
      personalAndGroupGraph: true,
      calendarOnly: true,
      privateNotifications: true,
      unreadCount: true,
      readOnOpen: true,
      keyboardAndRetry: true,
      responsive: [320, 390, 768, 1440],
      providerCalls: 0,
      bandwidth,
    }),
  );
} catch (e) {
  await testPage
    ?.screenshot({ path: ".tools/overview-ui/failure.png" })
    .catch(() => {});
  console.error(
    JSON.stringify({
      step,
      code: e.code || e.name,
      detail: e.message?.slice(0, 1500),
    }),
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
