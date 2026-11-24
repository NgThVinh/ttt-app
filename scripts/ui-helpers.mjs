import { expect } from "@playwright/test";

export async function setRsvp(page, going = true) {
  const group = page.getByRole("group", { name: "Tôi tham gia", exact: true });
  const button = group.getByRole("button");
  await expect(button).toHaveCount(1);
  await expect(group).toHaveAttribute("aria-busy", "false");
  if ((await button.getAttribute("aria-pressed")) !== String(going)) {
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().startsWith(new URL(page.url()).origin),
    );
    await Promise.all([button.click(), response]);
  }
  await expect(group).toHaveAttribute("aria-busy", "false");
  await expect(button).toHaveAttribute("aria-pressed", String(going));
  await expect(button).toHaveText(going ? "Đã tham gia" : "Tham gia");
  await expect(button).toBeEnabled();
}
