import { expect } from "@playwright/test";

export async function setRsvp(page, going = true) {
  const group = page.getByRole("group", { name: "Tôi tham gia", exact: true });
  const button = group.getByRole("button", {
    name: going ? "Tham gia" : "Không đi",
    exact: true,
  });
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().startsWith(new URL(page.url()).origin),
  );
  await button.click();
  await response;
  await expect(group).toHaveAttribute("aria-busy", "false");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toBeEnabled();
}
