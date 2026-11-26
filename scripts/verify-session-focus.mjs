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
    await expect(
      actor.page.locator(".session-workspace-frame.is-open"),
    ).toHaveCSS("opacity", "1");
    if (!audit) {
      const first = label.startsWith("planned")
        ? /session-participants/
        : /payment-list/;
      await expect(
        actor.page.locator(".detail-main > section").first(),
      ).toHaveClass(first);
    }
    await actor.page.locator(".session-workspace-body").evaluate((el) => {
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
        const bottom = document
          .querySelector(".session-workspace-body")
          .getBoundingClientRect().bottom;
        const visible = (selector) =>
          [...document.querySelectorAll(selector)].find((el) =>
            el.checkVisibility(),
          );
        const rect = (selector) => {
          const r = visible(selector)?.getBoundingClientRect();
          return r ? Math.round(r.bottom) : null;
        };
        return {
          viewport: innerHeight,
          fold: bottom,
          headerBottom: rect(".session-hero"),
          peopleBottom: rect(".session-participants"),
          costsBottom: rect(".expense-summary"),
          paymentTop: visible(".payment-list")
            ? Math.round(visible(".payment-list").getBoundingClientRect().top)
            : null,
          scrollHeight: document.querySelector(".session-workspace-body")
            .scrollHeight,
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
    step = "cost-dialog";
    await owner.page.setViewportSize({ width: 390, height: 844 });
    await owner.page.goto(origin + "/sessions/" + planned);
    const costsButton = owner.page.getByRole("button", {
      name: "Nhập phí và chốt buổi",
      exact: true,
    });
    await expect(costsButton).toBeInViewport({ ratio: 1 });
    await expect(
      owner.page.getByLabel("Tiền sân (đ)", { exact: true }),
    ).toBeHidden();
    await costsButton.click();
    await expect(owner.page.locator("#main-content")).toHaveCSS(
      "overflow-y",
      "hidden",
    );
    await expect(owner.page.locator(".session-task-content.is-open")).toHaveCSS(
      "opacity",
      "1",
    );
    await owner.page.getByLabel("Tiền sân (đ)", { exact: true }).fill("360000");
    await expect(owner.page.locator(".cost-total")).toContainText("360.000");
    await owner.page.keyboard.press("Escape");
    await expect(costsButton).toBeFocused();
    await costsButton.click();
    await expect(
      owner.page.getByLabel("Tiền sân (đ)", { exact: true }),
    ).toHaveValue("360000");
    await owner.page.screenshot({
      path: ".tools/session-focus/after-cost-task-390.png",
    });
    await owner.page.getByRole("button", { name: "Đóng", exact: true }).click();
    await expect(owner.page.locator(".session-task-dialog[open]")).toBeHidden();
    step = "first-viewport";
    await member.page.setViewportSize({ width: 390, height: 844 });
    await member.page.goto(origin + "/sessions/" + planned);
    let viewportItem = 0;
    for (const locator of [
      member.page
        .locator(".session-detail:visible")
        .getByText("Sân cầu lông Hoàng Minh", { exact: true }),
      member.page.locator(".my-attendance:visible"),
      member.page.locator(".attendance-groups:visible"),
      member.page.locator(".expense-summary:visible"),
    ]) {
      step = "planned-first-viewport:" + viewportItem++;
      await expect(locator).toBeInViewport({ ratio: 1 });
    }
    check(
      (await member.page
        .locator(".collector-change:visible")
        .getAttribute("open")) === null,
      "ROLE_FORM_NOT_DEFAULT",
    );
    await member.page.goto(origin + "/sessions/" + sid);
    for (const selector of [
      ".payment-list:visible",
      ".session-participants:visible",
      ".expense-summary:visible",
    ]) {
      step = "payer-first-viewport:" + selector;
      await expect(member.page.locator(selector)).toBeInViewport({ ratio: 1 });
    }
    await expect(member.page.locator(".roster-names")).toContainText("Vy");
    const payButton = member.page.getByRole("button", {
      name: "Thanh toán",
      exact: true,
    });
    await expect(payButton).toBeInViewport({ ratio: 1 });
    await payButton.click();
    await expect(
      member.page.locator(".session-task-dialog[open]"),
    ).toBeVisible();
    await expect(
      member.page.locator(".session-task-content.is-open"),
    ).toHaveCSS("opacity", "1");
    const taskBox = await member.page
      .locator(".session-task-dialog[open]")
      .boundingBox();
    check(
      Math.abs(taskBox.x + taskBox.width / 2 - 195) < 2 &&
        Math.abs(taskBox.y + taskBox.height / 2 - 422) < 2,
      "TASK_CENTERED",
    );
    await expect(
      member.page.getByRole("button", { name: "Tôi đã chuyển", exact: true }),
    ).toBeVisible();
    await member.page.screenshot({
      path: ".tools/session-focus/after-payment-task-390.png",
    });
    await member.page.keyboard.press("Escape");
    await expect(
      member.page.locator(".session-task-dialog[open]"),
    ).toBeHidden();
    await expect(payButton).toBeFocused();
    await payButton.click();
    check(
      (await member.page.locator(".payment-list > .payment-row").count()) === 1,
      "ONLY_MY_PAYMENT_EXPANDED",
    );
    await expect(
      member.page.locator(".personal-payment-amount:visible"),
    ).toContainText("30.000");
    check(
      await member.page
        .locator(".personal-payment-amount:visible")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 24),
      "PERSONAL_AMOUNT_VISUAL_PRIORITY",
    );
    const overview = await member.page
      .locator(".session-hero:visible")
      .boundingBox();
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
      owner.page.locator(
        '.payment-row[data-payment-id="' + mark + '"]:visible',
      ),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      owner.page
        .locator('.payment-row[data-payment-id="' + mark + '"]:visible')
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
    await member.page.setViewportSize({ width: 390, height: 844 });
    await member.page.emulateMedia({ colorScheme: "dark" });
    await capture(member, planned, "planned-dark");
    await member.page.emulateMedia({ reducedMotion: "reduce" });
    await member.page
      .getByRole("button", { name: "Lịch sử", exact: true })
      .click();
    await member.page.locator(".history-dialog").waitFor();
    await expect(
      member.page.locator(".history-dialog-content.is-open"),
    ).toHaveCSS("opacity", "1");
    const historyBox = await member.page
      .locator(".history-dialog")
      .boundingBox();
    check(
      Math.abs(historyBox.x + historyBox.width / 2 - 195) < 2 &&
        Math.abs(historyBox.y + historyBox.height / 2 - 422) < 2,
      "HISTORY_CENTERED",
    );
    await member.page.keyboard.press("Escape");
    await expect(member.page.locator(".history-dialog")).toBeHidden();
    step = "settled";
    await owner.page.emulateMedia({ reducedMotion: "reduce" });
    await owner.page.goto(origin + "/sessions/" + planned);
    await owner.page
      .getByRole("button", { name: "Nhập phí và chốt buổi", exact: true })
      .click();
    await expect(owner.page.locator(".session-task-content.is-open")).toHaveCSS(
      "transition-duration",
      "0s",
    );
    await owner.page.keyboard.press("Escape");
    await expect(owner.page.locator(".session-task-dialog[open]")).toBeHidden();
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
      detail: e.message?.slice(0, 650),
    }),
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
