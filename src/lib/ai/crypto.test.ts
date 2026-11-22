import { it, expect } from "vitest";
import { encryptGroupKey, decryptGroupKey } from "./crypto";
const secret = "a".repeat(48);
it("encrypts with fresh IVs and binds credentials to the exact group", () => {
  const a = encryptGroupKey("a", "private-key", secret),
    b = encryptGroupKey("a", "private-key", secret);
  expect(a).not.toEqual(b);
  expect(JSON.stringify(a)).not.toContain("private-key");
  expect(decryptGroupKey("a", a, secret)).toBe("private-key");
  expect(() => decryptGroupKey("b", a, secret)).toThrow();
  expect(() => decryptGroupKey("a", a, "b".repeat(48))).toThrow();
  expect(() =>
    decryptGroupKey("a", { ...a, tag: "A".repeat(22) }, secret),
  ).toThrow();
});
