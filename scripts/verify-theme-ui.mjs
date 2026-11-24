import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { localBrowser, check } from "./local-browser.mjs";
let app,
  step = "setup";
try {
  app = await localBrowser(3228, ".tools/theme-ui");
  const { db, origin } = app;
  const actor = await app.login("theme-member@3t.test");
  const { page } = actor;
  const group = randomUUID();
  await db.query(
    "insert into public.groups(id,name,sport,created_by) values($1,'Cầu lông cùng bạn','Cầu lông',$2)",
    [group, actor.user.id],
  );
  await db.query(
    "insert into public.group_members(group_id,user_id,display_name,role) values($1,$2,'Minh','member')",
    [group, actor.user.id],
  );
  await db.query(
    "insert into public.group_members(group_id,display_name) values($1,'An'),($1,'Bình'),($1,'Chi')",
    [group],
  );
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  await db.query(
    "insert into public.sessions(group_id,title,venue,starts_at,ends_at,commit_deadline,created_by) values($1,'Cầu lông buổi tối','Sân cầu lông trung tâm',$2::timestamptz,$2::timestamptz+interval '2 hours',$2::timestamptz,$3)",
    [group, tomorrow, actor.user.id],
  );
  await page.goto(origin + "/sessions/new");
  await page.getByLabel("Nhóm", { exact: true }).selectOption(group);
  step = "disclosure-keyboard-and-form-state";
  const advanced = page.getByRole("button", {
    name: "Người tính tiền & ghi chú",
    exact: true,
  });
  await expect(advanced).toHaveAttribute("aria-expanded", "false");
  const panel = page.locator(".meeting-options .t-acc-panel");
  await expect(panel).toHaveAttribute("inert", "");
  await advanced.focus();
  await advanced.press("Enter");
  await expect(advanced).toHaveAttribute("aria-expanded", "true");
  await page
    .getByLabel("Ghi chú", { exact: true })
    .fill("Mang vợt, đến trước 10 phút.");
  await advanced.click();
  await expect(panel).toHaveAttribute("inert", "");
  const formData = await page.locator(".meeting-editor form").evaluate((el) => {
    const data = new FormData(el);
    return { note: data.get("note"), mode: data.get("collectorMode") };
  });
  check(
    formData.note === "Mang vợt, đến trước 10 phút." &&
      formData.mode === "unknown",
    "CLOSED_FIELDS_STILL_SUBMIT",
  );
  step = "theme-contrast-and-responsive";
  async function checkContrast() {
    const ratios = await page.evaluate(() => {
      const rgb = (value) =>
        value
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
      const lum = (v) => {
        const [r, g, b] = rgb(v);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a, b) =>
        (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
      const body = getComputedStyle(document.body);
      const hint = getComputedStyle(document.querySelector(".field-hint"));
      const button = getComputedStyle(
        document.querySelector('.meeting-editor button[data-ui="button"]'),
      );
      return {
        body: ratio(body.color, body.backgroundColor),
        muted: ratio(hint.color, body.backgroundColor),
        button: ratio(button.color, button.backgroundColor),
      };
    });
    check(
      Object.values(ratios).every((v) => v >= 4.5),
      "TEXT_CONTRAST_4_5",
    );
    return ratios;
  }
  const contrast = {};
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page
        .getByRole("button", { name: "Bật giao diện tối", exact: true })
        .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      ),
    );
    contrast[theme] = await checkContrast();
    for (const width of [360, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      check(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "NO_HORIZONTAL_OVERFLOW",
      );
      await page.screenshot({
        path: `.tools/theme-ui/meeting-${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  step = "sliding-tabs-keyboard-and-resize";
  await page.goto(origin + "/sessions");
  const calendar = page.getByRole("tab", { name: "Lịch tháng", exact: true });
  const list = page.getByRole("tab", { name: "Danh sách", exact: true });
  await calendar.focus();
  await calendar.press("ArrowRight");
  await expect(list).toBeFocused();
  await expect(list).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveAccessibleName("Danh sách");
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(async () =>
        page.locator(".t-tabs").evaluate((el) => {
          const a = el
              .querySelector('[aria-selected="true"]')
              .getBoundingClientRect(),
            b = el.querySelector(".t-tabs-pill").getBoundingClientRect();
          return Math.abs(a.x - b.x) < 1 && Math.abs(a.width - b.width) < 1;
        }),
      )
      .toBe(true);
  }
  await list.press("ArrowLeft");
  await expect(calendar).toBeFocused();
  await expect(page.locator(".calendar-card")).toBeVisible();
  step = "reduced-motion";
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const selector of [".t-tabs-pill", ".t-icon-swap .t-icon"]) {
    const durations = await page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    check(
      durations.split(",").every((v) => parseFloat(v) <= 0.01),
      "REDUCED_MOTION_TABS_ICONS",
    );
  }
  await page.goto(origin + "/sessions/new");
  const reduced = page.locator(".meeting-options .t-acc-panel");
  check(
    parseFloat(
      await reduced.evaluate((el) => getComputedStyle(el).transitionDuration),
    ) <= 0.01,
    "REDUCED_MOTION_DISCLOSURE",
  );
  console.log(
    JSON.stringify({
      ok: true,
      localOnly: true,
      screenshots: 4,
      contrast,
      checks: [
        "keyboard tabs",
        "resize alignment",
        "disclosure focus",
        "retained form fields",
        "theme persistence",
        "reduced motion",
      ],
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      step,
      code: error.code || error.message?.slice(0, 700) || "UNKNOWN",
    }),
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
