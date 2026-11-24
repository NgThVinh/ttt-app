import { describe, expect, it } from "vitest";
import {
  calendarMarkers,
  markerLabel,
  markerStates,
  type CalendarPoll,
} from "./calendar-overview";
import type { SessionOverview } from "./session-overview";

const session = (
  overrides: Partial<SessionOverview> = {},
): SessionOverview => ({
  id: "s",
  title: "Buổi chơi",
  venue: "Sân",
  starts_at: "2026-11-24T22:00:00Z",
  status: "planned",
  ...overrides,
});
const poll: CalendarPoll = {
  id: "p",
  title: "Chọn giờ",
  venue: "Sân",
  closes_at: "2026-11-26T00:00:00Z",
  group_name: "Nhóm",
  options: [
    {
      id: "o1",
      starts_at: "2026-11-25T10:00:00Z",
      ends_at: "2026-11-25T11:00:00Z",
    },
    {
      id: "o2",
      starts_at: "2026-11-25T12:00:00Z",
      ends_at: "2026-11-25T13:00:00Z",
    },
  ],
};
describe("calendar overview", () => {
  it("keeps personal attendance, a confirmed booking and a poll on the same Vietnam date", () => {
    const markers = calendarMarkers(
      [session({ my_rsvp: "going", schedule_confirmed: true })],
      [poll],
    );
    expect(markers["2026-11-25"]).toEqual({
      joined: 1,
      confirmed: 1,
      voting: 1,
      tentative: 0,
    });
    expect(markers["2026-11-24"]).toBeUndefined();
    expect(markerStates(markers["2026-11-25"])).toBe("joined confirmed voting");
    expect(markerLabel(markers["2026-11-25"])).toContain("thăm dò đang vote");
  });
  it("does not mark an invitation as attendance or a finalized group schedule", () => {
    expect(
      calendarMarkers([session({ my_rsvp: "pending" })], [])["2026-11-25"],
    ).toEqual({ joined: 0, confirmed: 0, voting: 0, tentative: 1 });
  });
  it("excludes cancelled sessions even when old attendance was accepted", () => {
    expect(
      calendarMarkers(
        [
          session({
            status: "cancelled",
            my_rsvp: "going",
            schedule_confirmed: true,
          }),
        ],
        [],
      ),
    ).toEqual({});
  });
  it("marks finalized and settled sessions as confirmed without assuming the viewer joined", () => {
    expect(
      calendarMarkers(
        [
          session({ status: "played", my_rsvp: "not_going" }),
          session({ status: "settled" }),
        ],
        [],
      )["2026-11-25"],
    ).toEqual({ joined: 0, confirmed: 2, voting: 0, tentative: 0 });
  });
});
