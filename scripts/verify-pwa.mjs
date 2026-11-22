import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";
// Run after a production build. Only anonymous local GET requests are made.
const origin = "http://127.0.0.1:3218";
let server, browser, log;
function check(ok, code) {
  if (!ok) throw Object.assign(new Error(), { code });
}
try {
  try {
    await fetch(origin, { signal: AbortSignal.timeout(500) });
    throw Object.assign(new Error(), { code: "LOCAL_PORT_IN_USE" });
  } catch (error) {
    if (error.code === "LOCAL_PORT_IN_USE") throw error;
  }
  mkdirSync(".tools/pwa", { recursive: true });
  log = openSync(".tools/pwa/server.log", "w");
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3218",
    ],
    { windowsHide: true, stdio: ["ignore", log, log] },
  );
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) break;
    try {
      if (
        (await fetch(origin + "/login", { signal: AbortSignal.timeout(1000) }))
          .ok
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  check(ready, "PRODUCTION_SERVER_NOT_READY");
  const workerResponse = await fetch(origin + "/sw.js");
  check(
    workerResponse.headers.get("cache-control")?.includes("no-store"),
    "WORKER_MUST_REVALIDATE",
  );
  const manifest = await (await fetch(origin + "/manifest.webmanifest")).json();
  check(
    manifest.scope === "/" && manifest.display === "standalone",
    "MANIFEST_SCOPE",
  );
  for (const icon of manifest.icons)
    check((await fetch(origin + icon.src)).ok, "MANIFEST_ICON_MISSING");
  check(
    manifest.icons.some((icon) => icon.purpose === "maskable"),
    "MASKABLE_ICON_REQUIRED",
  );
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(origin + "/login");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.screenshot({
    path: ".tools/pwa/login-mobile.png",
    fullPage: true,
  });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "MOBILE_OVERFLOW",
  );
  check(
    (await page.locator('link[rel="apple-touch-icon"]').count()) === 1,
    "APPLE_ICON_LINK",
  );
  await page.goto(origin);
  await page.getByRole("heading", { name: /Chào bạn/ }).waitFor();
  check(
    (await page
      .getByRole("navigation", { name: "Điều hướng điện thoại" })
      .getByRole("link")
      .count()) === 5,
    "FIVE_MOBILE_NAV_ITEMS",
  );
  await page.getByRole("button", { name: /Chia thử một khoản/ }).click();
  const dialog = page.getByRole("dialog", { name: "Chia thử một khoản" });
  await dialog.waitFor();
  await page.getByLabel("Tổng tiền (đ)").fill("85000");
  await page.getByLabel("Số người", { exact: true }).fill("2");
  check(
    (await dialog.innerText()).includes("43.000đ") &&
      (await dialog.innerText()).includes("42.000đ"),
    "PREVIEW_MONEY_ROUNDING",
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  check(
    await page
      .getByRole("button", { name: /Chia thử một khoản/ })
      .evaluate((el) => el === document.activeElement),
    "DIALOG_RESTORES_FOCUS",
  );
  await page.getByRole("button", { name: "Bật giao diện tối" }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.reload();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.screenshot({
    path: ".tools/pwa/home-dark-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Bật giao diện sáng" }).click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: `.tools/pwa/home-${width}.png`,
      fullPage: true,
    });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "HOME_OVERFLOW_" + width,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const cachePaths = await page.evaluate(async () => {
    const paths = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys())
        paths.push(new URL(request.url).pathname);
    return paths.sort();
  });
  check(
    JSON.stringify(cachePaths) ===
      JSON.stringify(["/icon-192.png", "/offline.html"]),
    "ONLY_PUBLIC_FALLBACK_MAY_BE_CACHED",
  );
  await context.setOffline(true);
  await page.getByRole("status").filter({ hasText: "ngoại tuyến" }).waitFor();
  await page.goto(origin + "/debts");
  await page
    .getByRole("heading", { name: "Kết nối lại để tiếp tục" })
    .waitFor();
  check(
    !(await page.content()).includes("Công nợ của tôi"),
    "OFFLINE_MUST_NOT_REPLAY_PRIVATE_PAGE",
  );
  await page.screenshot({
    path: ".tools/pwa/offline-mobile.png",
    fullPage: true,
  });
  await context.setOffline(false);
  await page.goto(origin + "/login");
  await page.getByRole("button", { name: "Tiếp tục với Google" }).waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: ".tools/pwa/login-desktop.png",
    fullPage: true,
  });
  check(failures.length === 0, "BROWSER_RUNTIME_ERROR");
  const report = {
    passed: true,
    productionBuild: true,
    mobileNoOverflow: true,
    manifestIcons: true,
    workerRevalidates: true,
    offlineFallback: true,
    privatePageNotCached: true,
    onlineRecovery: true,
    responsiveHome: [320, 390, 768, 1440],
    nativeDialogKeyboard: true,
    darkModePersists: true,
    devicePushDeliveryTested: false,
  };
  writeFileSync(".tools/pwa/report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(JSON.stringify({ code: error.code || error.name }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
  if (log !== undefined) closeSync(log);
}
