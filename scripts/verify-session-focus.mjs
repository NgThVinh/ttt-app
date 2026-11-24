import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import { localBrowser, check } from "./local-browser.mjs";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(".tools/browsers"))
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".tools/browsers");
const audit = process.argv.includes("--audit");
let app,
  step = "setup";
try {
  app = await localBrowser(3226, ".tools/session-focus", {
    qrTemplate: "local-test",
  });
  const { db, origin } = app;
  const owner = await app.login("focus-owner@3t.test"),
    member = await app.login("focus-member@3t.test");
  for (const actor of [owner, member])
    await actor.context.route("https://img.vietqr.io/**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "image/png",
        body: readFileSync("public/icon-192.png"),
      }),
    );
  const g = randomUUID(),
    ids = Array.from({ length: 12 }, () => randomUUID()),
    names = [
      "An",
      "Bình",
      "Chi",
      "Dũng",
      "Hà",
      "Huy",
      "Linh",
      "Mai",
      "Minh",
      "Nam",
      "Phúc",
      "Vy",
    ];
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Session focus fixture','Cầu lông',$2)",
    [g, owner.user.id],
  );
  for (let i = 0; i < 12; i++)
    await db.query(
      "insert into public.group_members(id,group_id,user_id,display_name,role) values($1,$2,$3,$4,$5)",
      [
        ids[i],
        g,
        i === 0 ? owner.user.id : i === 1 ? member.user.id : null,
        names[i],
        i === 0 ? "admin" : "member",
      ],
    );
  await db.query(
    "insert into public.profiles(id,display_name,bank_bin,bank_account_no,bank_account_name) values($1,'An','970436','00001111','AN TEST LOCAL') on conflict(id) do update set bank_bin='970436',bank_account_no='00001111',bank_account_name='AN TEST LOCAL'",
    [owner.user.id],
  );
  const start = new Date(Date.now() + 86400000),
    end = new Date(+start + 7200000);
  const scheduled = await owner.client.rpc("schedule_meeting", {
    request_key: randomUUID(),
    body: {
      g,
      title_text: "Cầu lông cuối tuần",
      venue_text: "Sân cầu lông Hoàng Minh",
      start_time: start.toISOString(),
      ends_at: end.toISOString(),
      deadline: start.toISOString(),
      note: "Sân số 3 · Mang áo sáng màu",
      be_collector: true,
      nominee: "",
      invitees: ids,
    },
  });
  check(!scheduled.error, "SCHEDULE");
  const planned = scheduled.data.id;
  await db.query(
    "update public.session_attendees set rsvp='going',committed_at=now(),commit_source='self' where session_id=$1 and member_id=any($2::uuid[])",
    [planned, ids.slice(0, 6)],
  );
  const played = await owner.client.rpc("execute_financial_command", {
    command_name: "create_session_bundle",
    request_key: randomUUID(),
    body: {
      g,
      title_text: "Cầu lông tối thứ tư",
      venue_text: "Sân cầu lông Hoàng Minh",
      start_time: new Date(Date.now() - 86400000).toISOString(),
      deadline: new Date(Date.now() - 86400000).toISOString(),
      already_played: true,
      people: ids,
      court: "360000",
      be_collector: true,
      weights: {},
      extras: [],
      nominee: "",
    },
  });
  check(!played.error, "PLAYED");
  const sid = played.data.id;
  const mark = (
    await db.query(
      "select id from public.settlements where session_id=$1 and from_member=$2",
      [sid, ids[1]],
    )
  ).rows[0].id;
  const measurements = [];
  async function capture(actor, id, label) {
    await actor.page.goto(origin + "/sessions/" + id);
    await actor.page.getByRole("heading", { level: 1 }).waitFor();
    if (!audit && label.includes("planned-collector"))
      await actor.page
        .getByLabel("Tiền sân (đ)", { exact: true })
        .fill("360000");
    if (!audit && label.includes("planned-collector"))
      await expect(
        actor.page.getByRole("button", {
          name: "Chốt toàn bộ chi phí",
          exact: true,
        }),
      ).toBeInViewport({ ratio: 1 });
    if (!audit) {
      const first = label.includes("planned-collector")
        ? /expense-summary/
        : label.startsWith("planned")
          ? /session-participants/
          : /payment-list/;
      await expect(
        actor.page.locator(".detail-main > section").first(),
      ).toHaveClass(first);
    }
    await actor.page.locator("#main-content").evaluate((el) => {
      el.scrollTop = 0;
    });
    await actor.page.screenshot({
      path:
        ".tools/session-focus/" +
        (audit ? "before-" : "after-") +
        label +
        ".png",
      fullPage: true,
    });
    measurements.push({
      label,
      ...(await actor.page.evaluate(() => {
        const bottom =
          innerHeight -
          (document.querySelector(".bottom-nav")?.getBoundingClientRect()
            .height || 69);
        const rect = (selector) => {
          const r = document.querySelector(selector)?.getBoundingClientRect();
          return r ? Math.round(r.bottom) : null;
        };
        return {
          viewport: innerHeight,
          fold: bottom,
          headerBottom: rect(".session-hero"),
          peopleBottom: rect(".session-participants"),
          costsBottom: rect(".expense-summary"),
          paymentTop: document.querySelector(".payment-list")
            ? Math.round(
                document.querySelector(".payment-list").getBoundingClientRect()
                  .top,
              )
            : null,
          scrollHeight: document.querySelector("#main-content").scrollHeight,
        };
      })),
    });
  }
  for (const [width, height] of [
    [390, 844],
    [1440, 960],
  ]) {
    await member.page.setViewportSize({ width, height });
    await owner.page.setViewportSize({ width, height });
    await capture(member, planned, "planned-member-" + width);
    await capture(owner, planned, "planned-collector-" + width);
    await capture(member, sid, "payer-" + width);
    await capture(owner, sid, "receiver-" + width);
  }
  if (!audit) {
    step = "first-viewport";
    await member.page.setViewportSize({ width: 390, height: 844 });
    await member.page.goto(origin + "/sessions/" + planned);
    for (const locator of [
      member.page.getByText("Sân cầu lông Hoàng Minh", { exact: true }),
      member.page.locator(".my-attendance"),
      member.page.locator(".attendance-groups"),
      member.page.locator(".expense-summary"),
    ]) {
      await expect(locator).toBeInViewport({ ratio: 1 });
    }
    check(
      (await member.page.locator(".collector-change").getAttribute("open")) ===
        null,
      "ROLE_FORM_NOT_DEFAULT",
    );
    await member.page.goto(origin + "/sessions/" + sid);
    await expect(
      member.page.getByRole("button", { name: "Tôi đã chuyển", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    check(
      (await member.page.locator(".payment-list > .payment-row").count()) === 1,
      "ONLY_MY_PAYMENT_EXPANDED",
    );
    await expect(member.page.locator(".personal-payment-amount")).toContainText(
      "30.000",
    );
    const overview = await member.page.locator(".session-hero").boundingBox();
    check(overview.y + overview.height < 320, "COMPACT_HEADER");
    step = "marked-paid";
    await member.page
      .getByRole("button", { name: "Tôi đã chuyển", exact: true })
      .click();
    await member.page
      .getByText("Đã báo chuyển · Chờ xác nhận", { exact: true })
      .waitFor();
    await owner.page.setViewportSize({ width: 390, height: 844 });
    await owner.page.goto(origin + "/sessions/" + sid);
    await expect(
      owner.page.locator('.payment-row[data-payment-id="' + mark + '"]'),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      owner.page
        .locator('.payment-row[data-payment-id="' + mark + '"]')
        .getByRole("button", { name: "Đã nhận", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    step = "small-and-dark";
    for (const width of [320, 390, 768, 1440]) {
      await member.page.setViewportSize({ width, height: 844 });
      await member.page.goto(origin + "/sessions/" + planned);
      check(
        await member.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "NO_HORIZONTAL_SCROLL",
      );
      check(
        await member.page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight + 1,
        ),
        "DOCUMENT_NOT_SCROLLING",
      );
    }
    await member.page.emulateMedia({ colorScheme: "dark" });
    await capture(member, planned, "planned-dark");
    await member.page.emulateMedia({ reducedMotion: "reduce" });
    await member.page
      .getByRole("button", { name: "Lịch sử", exact: true })
      .click();
    await member.page.getByRole("dialog").waitFor();
    await member.page.keyboard.press("Escape");
    await expect(member.page.getByRole("dialog")).toBeHidden();
    step = "settled";
    await db.query(
      "update public.settlements set status='confirmed',confirmed_at=now() where session_id=$1 and status<>'confirmed'",
      [sid],
    );
    await db.query(
      "update public.sessions set status='settled',settled_at=now() where id=$1",
      [sid],
    );
    await member.page.setViewportSize({ width: 390, height: 844 });
    await capture(member, sid, "settled-member");
    await expect(
      member.page.getByText("Bạn đã thanh toán xong", { exact: true }),
    ).toBeInViewport({ ratio: 1 });
  }
  writeFileSync(
    ".tools/session-focus/" + (audit ? "before" : "after") + "-metrics.json",
    JSON.stringify(measurements, null, 2),
  );
  console.log(
    JSON.stringify({ passed: true, audit, measurements, providerCalls: 0 }),
  );
} catch (e) {
  console.error(
    JSON.stringify({
      step,
      code: e.code || e.name,
      detail: e.message?.split("\n")[0]?.slice(0, 160),
    }),
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
