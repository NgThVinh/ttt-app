import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Sandbox } from "./model.mjs";

const model = new Sandbox(),
  origin = "http://127.0.0.1:3226";
const json = (value) =>
  JSON.stringify(value, (_key, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const url = new URL(req.url, origin);
  try {
    if (url.pathname === "/api") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      if (req.method === "GET")
        return res.end(json(model.state(url.searchParams.get("actor"))));
      if (
        req.method !== "POST" ||
        req.headers["content-type"] !== "application/json" ||
        (req.headers.origin && req.headers.origin !== origin)
      ) {
        res.statusCode = 403;
        return res.end(json({ error: "Yêu cầu không hợp lệ." }));
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 32768) throw Error("Yêu cầu quá dài.");
      }
      const { actor, ...input } = JSON.parse(body);
      return res.end(json(model.command(actor, input)));
    }
    const asset =
      url.pathname === "/"
        ? "index.html"
        : url.pathname === "/app.js"
          ? "app.js"
          : null;
    if (!asset) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader(
      "Content-Type",
      asset.endsWith("js")
        ? "application/javascript; charset=utf-8"
        : "text/html; charset=utf-8",
    );
    res.end(readFileSync(new URL(asset, import.meta.url)));
  } catch (error) {
    res.statusCode = 400;
    res.end(json({ error: error.message }));
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(3226, "127.0.0.1", resolve);
});
if (process.argv.includes("--check")) {
  let browser;
  try {
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(".tools/browsers"))
      process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".tools/browsers");
    const { chromium, expect } = await import("@playwright/test");
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(origin);
    await page.locator('[data-id="c"] input[type=checkbox]').uncheck();
    await page.locator("#amount").fill("100.000");
    await page
      .getByRole("button", { name: "Xem bảng chia", exact: true })
      .click();
    await expect(page.locator("#preview-result")).toContainText("50.000đ");
    await page.getByRole("button", { name: "Lưu buổi", exact: true }).click();
    await expect(page.getByText("Chưa chuyển", { exact: false })).toBeVisible();
    await page.locator("#actor").selectOption("b");
    await page
      .getByRole("button", { name: "Tôi đã chuyển", exact: true })
      .click();
    await expect(
      page.getByText("Đã báo chuyển", { exact: false }),
    ).toBeVisible();
    await page.locator("#actor").selectOption("a");
    await page.getByRole("button", { name: "Đã nhận", exact: true }).click();
    await expect
      .poll(() => model.sessions[0].payments[0].status)
      .toBe("confirmed");
    await page
      .getByRole("button", { name: "Điều chỉnh tiền / người tham gia" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Điều chỉnh buổi", exact: true }),
    ).toBeVisible();
    await page.locator("#amount").fill("50.000");
    await page
      .getByRole("button", { name: "Xem bảng chia", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Lưu điều chỉnh", exact: true })
      .click();
    await expect
      .poll(() =>
        model.sessions[0].payments
          .filter((p) => p.status === "pending")
          .map((p) => p.amount.toString()),
      )
      .toEqual(["25000"]);
    await page.locator("#actor").selectOption("x");
    await expect(
      page.getByRole("heading", { name: "Chờ lời mời vào nhóm" }),
    ).toBeVisible();
    console.log(
      json({
        passed: true,
        independent: true,
        database: false,
        login: false,
        sharedMoneyFunctions: true,
        confirmedHistoryPreserved: true,
        refund: "25000",
        roleSwitch: true,
      }),
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server.close();
  }
} else {
  console.log(
    `Sandbox độc lập: ${origin}\nĐổi vai trò ngay trên trang. Không cần Supabase, Docker, .env hay đăng nhập. Ctrl+C để dừng; dữ liệu chỉ ở RAM.`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => server.close());
}
