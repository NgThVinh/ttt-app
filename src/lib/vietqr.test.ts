import { it, expect } from "vitest";
import { vietQrUrl } from "./vietqr";
it("encodes the amount and reference with an operator template", () => {
  const u = new URL(
    vietQrUrl(
      "970415",
      "12345678",
      "100000",
      "ABCD23",
      "NGUYEN VAN A",
      "my_template",
    )!,
  );
  expect(u.searchParams.get("amount")).toBe("100000");
  expect(u.searchParams.get("addInfo")).toBe("3T-ABCD23");
  expect(u.searchParams.get("accountName")).toBe("NGUYEN VAN A");
});
it("falls back for missing templates, oversized accounts and invalid amounts", () => {
  expect(vietQrUrl("970415", "12345678", "1", "ABCD23", "A", "")).toBeNull();
  expect(
    vietQrUrl("970415", "1".repeat(20), "1", "ABCD23", "A", "test"),
  ).toBeNull();
  expect(
    vietQrUrl("970415", "12345678", "-1", "ABCD23", "A", "test"),
  ).toBeNull();
});
