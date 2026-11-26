import { expect, it } from "vitest";
import {
  calendarMarkers,
  markerLabel,
  markerStates,
} from "./calendar-overview";
import type { SessionOverview } from "./session-overview";
const session = (patch: Partial<SessionOverview> = {}): SessionOverview => ({
  id: "s",
  title: "Buổi",
  venue: "Sân",
  starts_at: "2026-11-24T22:00:00Z",
  status: "planned",
  ...patch,
});
it("shows joined and finalized sessions on the Vietnam date", () => {
  const marks = calendarMarkers([
    session({ my_rsvp: "going", schedule_confirmed: true }),
  ]);
  expect(marks["2026-11-25"]).toEqual({
    joined: 1,
    confirmed: 1,
    tentative: 0,
  });
  expect(marks["2026-11-24"]).toBeUndefined();
  expect(markerStates(marks["2026-11-25"])).toBe("joined confirmed");
  expect(markerLabel(marks["2026-11-25"])).toContain("bạn tham gia");
});
it("pending invitation does not mean accepted attendance", () => {
  expect(
    calendarMarkers([session({ my_rsvp: "pending" })])["2026-11-25"],
  ).toEqual({ joined: 0, confirmed: 0, tentative: 1 });
});
it("ignores cancelled sessions and has no voting marker", () => {
  expect(
    calendarMarkers([session({ status: "cancelled", my_rsvp: "going" })]),
  ).toEqual({});
  expect(
    markerStates(calendarMarkers([session()])["2026-11-25"]),
  ).not.toContain("voting");
});
it("finalized and settled sessions are confirmed without assuming the viewer joined", () => {
  expect(
    calendarMarkers([
      session({ status: "played", my_rsvp: "not_going" }),
      session({ status: "settled" }),
    ])["2026-11-25"],
  ).toEqual({ joined: 0, confirmed: 2, tentative: 0 });
});
