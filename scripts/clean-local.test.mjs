import { describe, expect, it } from "vitest";
import { isFixtureGroup } from "./clean-local.mjs";

describe("local cleanup ownership", () => {
  it("protects the seeded group even if its name or owner resembles a fixture", () => {
    expect(
      isFixtureGroup({
        id: "00000000-0000-4000-8000-000000003001",
        name: "Nhóm UX",
        owner: "calendar-11111111-1111-4111-8111-111111111111@3t.test",
      }),
    ).toBe(false);
  });
  it("requires both the fixture name and the exact automated owner", () => {
    expect(
      isFixtureGroup({
        id: "fixture",
        name: "Payment browser fixture",
        owner: "payment-receiver@3t.test",
      }),
    ).toBe(true);
    expect(
      isFixtureGroup({
        id: "manual",
        name: "Payment browser fixture",
        owner: "an@local.3t.test",
      }),
    ).toBe(false);
    expect(
      isFixtureGroup({
        id: "manual",
        name: "Nhóm tự tạo",
        owner: "payment-receiver@3t.test",
      }),
    ).toBe(false);
  });
  it("only recognizes generated calendar account IDs, not arbitrary test-domain users", () => {
    expect(
      isFixtureGroup({
        id: "fixture",
        name: "Nhóm UX",
        owner: "calendar-11111111-1111-4111-8111-111111111111@3t.test",
      }),
    ).toBe(true);
    expect(
      isFixtureGroup({
        id: "manual",
        name: "Nhóm UX",
        owner: "someone@3t.test",
      }),
    ).toBe(false);
    expect(
      isFixtureGroup({
        id: "manual",
        name: "Nhóm UX",
        owner: "calendar-fake@3t.test",
      }),
    ).toBe(false);
  });
});
