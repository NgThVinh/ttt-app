import { it, expect } from "vitest";
import {
  parseSuperAdminEmails,
  envAllowsSuperAdmin,
} from "./super-admin-config.mjs";
it("normalizes and deduplicates the deployment allowlist", () => {
  expect(
    parseSuperAdminEmails(
      " Owner@Example.com,owner@example.com, Another@example.com ",
    ),
  ).toEqual(["another@example.com", "owner@example.com"]);
});
it("fails closed on empty/malformed lists or an unverified identity", () => {
  for (const value of [
    "",
    "owner@example.com,",
    "not-an-email",
    "owner@example.com,wrong",
  ]) {
    expect(() => parseSuperAdminEmails(value)).toThrow();
    expect(envAllowsSuperAdmin("owner@example.com", "2026-01-01", value)).toBe(
      false,
    );
  }
  expect(
    envAllowsSuperAdmin("owner@example.com", null, "owner@example.com"),
  ).toBe(false);
  expect(
    envAllowsSuperAdmin("other@example.com", "2026-01-01", "owner@example.com"),
  ).toBe(false);
  expect(
    envAllowsSuperAdmin("OWNER@example.com", "2026-01-01", "owner@example.com"),
  ).toBe(true);
  expect(parseSuperAdminEmails("", true)).toEqual([]);
});
