import { it, expect } from "vitest";
import { safeReturnPath } from "./auth-redirect";
it("preserves only valid invite return paths", () => {
  const path = "/join/" + "a".repeat(64);
  expect(safeReturnPath(path)).toBe(path);
  const meetingInvite = path + "?session=00000000-0000-4000-8000-000000000001";
  expect(safeReturnPath(meetingInvite)).toBe(meetingInvite);
  expect(safeReturnPath(meetingInvite + "&next=//evil.test")).toBe("/");
  for (const value of [
    "//evil.test",
    "https://evil.test",
    "/\\evil.test",
    "/join/%2f%2fevil.test",
    "/join/" + "a".repeat(64) + "?next=evil",
    null,
  ])
    expect(safeReturnPath(value)).toBe("/");
});
