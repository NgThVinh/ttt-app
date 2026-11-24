import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import { setRsvp } from "./ui-helpers.mjs";
import { localBrowser, check } from "./local-browser.mjs";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(".tools/browsers"))
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".tools/browsers");
let app,
  step = "start";
try {
  app = await localBrowser(3221, ".tools/poll-ui");
  const { db, origin } = app;
  const admin = await app.login("poll-admin@3t.test"),
    member = await app.login("poll-member@3t.test");
  const group = randomUUID(),
    ids = [randomUUID(), randomUUID()];
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Poll browser fixture','Test',$2)",
    [group, admin.user.id],
  );
  for (const [i, actor] of [admin, member].entries())
    await db.query(
      "insert into public.group_members(id,group_id,user_id,display_name,role) values($1,$2,$3,$4,$5)",
      [ids[i], group, actor.user.id, i ? "Bình" : "An", i ? "member" : "admin"],
    );
  step = "create";
  await admin.page.goto(origin + "/polls");
  check(
    (await admin.page.locator("form").count()) === 0,
    "LIST_HAS_NO_CREATE_FORM",
  );
  await admin.page
    .getByRole("link", { name: "+ Tạo thăm dò", exact: true })
    .click();
  await admin.page.getByLabel("Nhóm", { exact: true }).selectOption(group);
  check(
    (await admin.page
      .getByText("Số người đồng ý tối thiểu", { exact: true })
      .count()) === 0,
    "NO_THRESHOLD_FIELD",
  );
  await admin.page
    .getByLabel("Tên thăm dò", { exact: true })
    .fill("Chọn lịch cuối tuần");
  await admin.page
    .getByRole("button", { name: "Gửi thăm dò", exact: true })
    .click();
  await admin.page.waitForURL(/\/polls\/[a-f0-9-]{36}$/);
  const poll = new URL(admin.page.url()).pathname.split("/").at(-1);
  const options = (
    await db.query(
      "select id,starts_at,ends_at from public.poll_options where poll_id=$1 order by starts_at",
      [poll],
    )
  ).rows;
  check(options.length === 2, "DEFAULT_TWO_OPTIONS");
  const option = options[0].id;
  await db.query("update public.polls set min_attendees=100 where id=$1", [
    poll,
  ]);
  let realtimeFrames = 0;
  admin.page.on("websocket", (ws) =>
    ws.on("framereceived", (frame) => {
      try {
        const raw = JSON.parse(String(frame.payload));
        if ((Array.isArray(raw) ? raw[3] : raw.event) === "postgres_changes")
          realtimeFrames++;
      } catch {}
    }),
  );
  await admin.page.reload();
  let panel = admin.page.getByRole("region", {
    name: "Khung giờ 1",
    exact: true,
  });
  await panel.getByRole("button", { name: "Đi được", exact: true }).click();
  await panel.getByText("1 đi được", { exact: true }).waitFor();
  await member.page.goto(origin + "/polls/" + poll);
  step = "realtime";
  const before = realtimeFrames,
    at = Date.now();
  await member.page
    .getByRole("region", { name: "Khung giờ 1", exact: true })
    .getByRole("button", { name: "Đi được", exact: true })
    .click();
  await panel
    .getByText("2 đi được", { exact: true })
    .waitFor({ timeout: 12000 });
  const latency = Date.now() - at;
  await expect.poll(() => realtimeFrames).toBeGreaterThan(before);
  for (const width of [320, 390, 1440]) {
    await member.page.setViewportSize({ width, height: 900 });
    check(
      await member.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "POLL_OVERFLOW",
    );
    await member.page.screenshot({
      path: ".tools/poll-ui/poll-" + width + ".png",
      fullPage: true,
    });
  }
  await member.page.emulateMedia({ colorScheme: "dark" });
  await member.page.screenshot({
    path: ".tools/poll-ui/poll-dark.png",
    fullPage: true,
  });
  await member.page.emulateMedia({ colorScheme: "light" });
  step = "prefill";
  await member.page
    .getByRole("region", { name: "Khung giờ 1", exact: true })
    .getByRole("link", { name: "Tạo buổi với khung giờ này", exact: true })
    .click();
  await member.page
    .getByRole("heading", { name: "Tạo buổi chơi", exact: true })
    .waitFor();
  check(
    (await member.page
      .getByRole("button", { name: "Nhập buổi đã chơi", exact: true })
      .count()) === 0,
    "PREFILL_PLANNED_ONLY",
  );
  await expect(member.page.getByLabel("Tên buổi", { exact: true })).toHaveValue(
    "Chọn lịch cuối tuần",
  );
  await expect(
    member.page.getByRole("checkbox", { name: "An", exact: true }),
  ).toBeChecked();
  await expect(
    member.page.getByRole("checkbox", { name: "Bình", exact: true }),
  ).toBeChecked();
  check(
    (
      await db.query(
        "select count(*)::int n from public.sessions where group_id=$1",
        [group],
      )
    ).rows[0].n === 0,
    "GET_PREFILL_MUST_NOT_SAVE",
  );
  await member.page
    .getByLabel("Tên buổi", { exact: true })
    .fill("Buổi đã xem lại");
  await member.page.getByLabel("Địa điểm", { exact: true }).fill("Sân đã chọn");
  await member.page
    .getByRole("button", { name: "Tạo lịch", exact: true })
    .click();
  await member.page.waitForURL(/\/sessions\/[a-f0-9-]{36}$/);
  const sid = new URL(member.page.url()).pathname.split("/").at(-1);
  const saved = (
    await db.query(
      "select title,venue,collector_member_id from public.sessions where id=$1",
      [sid],
    )
  ).rows[0];
  check(
    saved.title === "Buổi đã xem lại" &&
      saved.venue === "Sân đã chọn" &&
      saved.collector_member_id === null,
    "REVIEWED_FORM_PERSISTS",
  );
  const attendees = (
    await db.query(
      "select rsvp,committed_at from public.session_attendees where session_id=$1",
      [sid],
    )
  ).rows;
  check(
    attendees.length === 2 &&
      attendees.every((a) => a.rsvp === "none" && a.committed_at === null),
    "VOTES_ONLY_INVITE_NOT_COMMIT",
  );
  await setRsvp(member.page);
  await admin.page.goto(origin + "/polls/" + poll);
  await admin.page
    .getByRole("link", { name: "Xem buổi chơi", exact: true })
    .waitFor();
  check(
    (await admin.page
      .getByRole("link", { name: "Tạo buổi với khung giờ này", exact: true })
      .count()) === 0,
    "ONLY_ONE_SESSION_LINK",
  );
  await admin.page.goto(
    origin + "/sessions/new?poll=" + poll + "&option=" + option,
  );
  await admin.page.waitForURL(origin + "/sessions/" + sid);
  step = "close-and-race";
  const start = new Date(Date.now() + 2 * 86400000).toISOString(),
    end = new Date(Date.now() + 2 * 86400000 + 7200000).toISOString();
  const created = await admin.client.rpc("create_poll", {
    g: group,
    title_text: "Đóng rồi tạo",
    venue_text: "Sân",
    minimum: 100,
    deadline: new Date(Date.now() + 3600000).toISOString(),
    options: [{ starts_at: start, ends_at: end }],
  });
  check(!created.error, "SECOND_POLL");
  const second = created.data;
  await admin.page.goto(origin + "/polls/" + second);
  await admin.page
    .getByRole("button", { name: "Đóng thăm dò", exact: true })
    .click();
  await expect(
    admin.page.getByText("Thăm dò đã ngừng nhận phiếu.", { exact: true }),
  ).toBeVisible();
  check(
    (
      await db.query(
        "select resulting_session_id from public.polls where id=$1",
        [second],
      )
    ).rows[0].resulting_session_id === null,
    "CLOSE_NEVER_SCHEDULES",
  );
  const secondOption = (
    await db.query("select id from public.poll_options where poll_id=$1", [
      second,
    ])
  ).rows[0].id;
  const body = {
    g: group,
    title_text: "Race form",
    venue_text: "Court",
    start_time: start,
    ends_at: end,
    deadline: start,
    note: "",
    be_collector: false,
    nominee: "",
    invitees: [],
  };
  const keys = [randomUUID(), randomUUID()];
  const results = await Promise.all(
    [admin, member].map((actor, i) =>
      actor.client.rpc("schedule_poll_meeting", {
        request_key: keys[i],
        target_poll: second,
        chosen_option: secondOption,
        body,
      }),
    ),
  );
  check(
    results.filter((r) => !r.error).length === 1,
    "CONCURRENT_CREATE_ONE_WINNER",
  );
  const winner = results.findIndex((r) => !r.error);
  const retry = await [admin, member][winner].client.rpc(
    "schedule_poll_meeting",
    {
      request_key: keys[winner],
      target_poll: second,
      chosen_option: secondOption,
      body,
    },
  );
  check(
    !retry.error &&
      retry.data.replayed === true &&
      retry.data.id === results[winner].data.id,
    "RETRY_SAME_SESSION",
  );
  const denied = await member.client.rpc("close_poll", {
    target: second,
    chosen: secondOption,
  });
  check(
    !denied.error && denied.data === results[winner].data.id,
    "LEGACY_RETURNS_EXISTING_RESULT_ONLY",
  );
  step = "invalid-source";
  await member.page.goto(
    origin + "/sessions/new?poll=" + poll + "&option=" + secondOption,
  );
  await member.page
    .getByRole("heading", { name: "Buổi đã xem lại", exact: true })
    .waitFor();
  console.log(
    JSON.stringify({
      passed: true,
      localOnly: true,
      providerCalls: 0,
      simplePoll: true,
      oneClickVote: true,
      websocketEvent: true,
      updateMs: latency,
      manualPrefill: true,
      noWriteOnGet: true,
      reviewedFieldsSaved: true,
      votesOnlyInvite: true,
      closeDoesNotCreate: true,
      concurrentOneSession: true,
      retrySafe: true,
      responsive: [320, 390, 1440],
      darkMode: true,
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
