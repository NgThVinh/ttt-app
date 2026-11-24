import { randomUUID } from "node:crypto";
import { setRsvp } from "./ui-helpers.mjs";
import { localBrowser, check } from "./local-browser.mjs";
let app,
  step = "start";
const realtimeDebug = [];
try {
  app = await localBrowser(3221, ".tools/poll-ui");
  const { db, origin } = app;
  const admin = await app.login("poll-admin@3t.test"),
    member = await app.login("poll-member@3t.test");
  const group = randomUUID();
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Poll browser fixture','Test',$2)",
    [group, admin.user.id],
  );
  for (const [index, actor] of [admin, member].entries())
    await db.query(
      "insert into public.group_members(group_id,user_id,display_name,role) values($1,$2,$3,$4)",
      [
        group,
        actor.user.id,
        index ? "Poll member" : "Poll admin",
        index ? "member" : "admin",
      ],
    );
  const start = new Date(Date.now() + 86400000).toISOString(),
    end = new Date(Date.now() + 90000000).toISOString();
  const created = await admin.client.rpc("create_poll", {
    g: group,
    title_text: "Realtime poll fixture",
    venue_text: "Local court",
    minimum: 2,
    deadline: new Date(Date.now() + 3600000).toISOString(),
    options: [{ starts_at: start, ends_at: end }],
  });
  check(!created.error, "CREATE_POLL_FAILED");
  const poll = created.data;
  const option = (
    await db.query("select id from public.poll_options where poll_id=$1", [
      poll,
    ])
  ).rows[0].id;
  let realtimeFrames = 0;
  admin.page.on("websocket", (ws) =>
    ws.on("framereceived", (frame) => {
      try {
        const raw = JSON.parse(String(frame.payload));
        const event = Array.isArray(raw)
          ? { event: raw[3], payload: raw[4] }
          : raw;
        realtimeDebug.push({
          event: event.event,
          status: event.payload?.status,
          message: event.payload?.message,
        });
        if (event.event === "postgres_changes") realtimeFrames++;
      } catch {}
    }),
  );
  await admin.page.goto(origin + "/polls/" + poll);
  await admin.page
    .getByRole("heading", { name: "Realtime poll fixture", exact: true })
    .waitFor();
  const panel = admin.page.locator("section.panel");
  step = "threshold";
  await panel
    .getByRole("button", {
      name: "Chốt khung giờ này và tạo buổi",
      exact: true,
    })
    .click();
  await panel
    .getByRole("alert")
    .filter({ hasText: "Chưa chốt được" })
    .waitFor();
  check(
    (
      await db.query(
        "select resulting_session_id from public.polls where id=$1",
        [poll],
      )
    ).rows[0].resulting_session_id === null,
    "BELOW_THRESHOLD_MUST_NOT_CREATE_SESSION",
  );
  await panel.getByLabel("Khả năng tham gia").selectOption("yes");
  await panel
    .getByRole("button", { name: "Lưu lựa chọn", exact: true })
    .click();
  await panel.getByText("1 đi được", { exact: false }).waitFor();
  await member.page.goto(origin + "/polls/" + poll);
  await member.page
    .getByRole("heading", { name: "Realtime poll fixture", exact: true })
    .waitFor();
  step = "realtime";
  const before = realtimeFrames;
  const at = Date.now();
  await member.page.getByLabel("Khả năng tham gia").selectOption("yes");
  await member.page
    .getByRole("button", { name: "Lưu lựa chọn", exact: true })
    .click();
  await panel
    .getByText("2 đi được", { exact: false })
    .waitFor({ timeout: 12000 });
  const latency = Date.now() - at;
  for (let i = 0; i < 50 && realtimeFrames <= before; i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  check(realtimeFrames > before, "REALTIME_EVENT_REQUIRED_NOT_POLLING");
  step = "close";
  await panel
    .getByRole("button", {
      name: "Chốt khung giờ này và tạo buổi",
      exact: true,
    })
    .click();
  await admin.page.waitForURL(/\/sessions\/[a-f0-9-]{36}$/);
  const sid = new URL(admin.page.url()).pathname.split("/").pop();
  await admin.page
    .getByRole("heading", { name: "Realtime poll fixture", exact: true })
    .waitFor();
  const repeat = await admin.client.rpc("close_poll", {
    target: poll,
    chosen: option,
  });
  check(!repeat.error && repeat.data === sid, "CLOSE_RETRY_MUST_REUSE_SESSION");
  const state = (
    await db.query(
      "select s.status,s.collector_member_id,(select count(*) from public.session_attendees a where a.session_id=s.id and a.rsvp='going' and a.committed_at is not null) as committed from public.sessions s where s.id=$1",
      [sid],
    )
  ).rows[0];
  check(
    state.status === "planned" &&
      state.collector_member_id === null &&
      state.committed === "0",
    "VOTES_MUST_NOT_AUTO_COMMIT_ATTENDANCE",
  );
  step = "rsvp";
  await member.page.goto(origin + "/sessions/" + sid);
  await setRsvp(member.page);
  check(
    (
      await db.query(
        "select count(*) from public.session_attendees where session_id=$1 and rsvp='going' and committed_at is not null",
        [sid],
      )
    ).rows[0].count === "1",
    "ONLY_VOTER_SELF_RSVP",
  );
  await admin.page.screenshot({
    path: ".tools/poll-ui/created-session.png",
    fullPage: true,
    caret: "initial",
  });
  console.log(
    JSON.stringify({
      passed: true,
      localOnly: true,
      providerCalls: 0,
      thresholdEnforced: true,
      websocketEvent: true,
      updateMs: latency,
      closeRetrySameSession: true,
      votesDoNotCommitAttendance: true,
      selfRsvp: true,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({ code: error.code || error.name, step, realtimeDebug }),
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
