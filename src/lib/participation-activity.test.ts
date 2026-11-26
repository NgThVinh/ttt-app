import { expect, it } from "vitest";
import { participationWindow, weeklyFrequency } from "./participation-activity";

it("aligns weeks to Monday across years and keeps future days out of totals", () => {
  const result = participationWindow(
    {
      today: "2026-01-01",
      group_count: 1,
      days: [
        { day: "2025-12-29", mine: 2, group_sessions: 3 },
        { day: "2026-01-01", mine: 1, group_sessions: 2 },
        { day: "2026-01-02", mine: 10, group_sessions: 10 },
      ],
    },
    2,
  );
  expect(result.days[0].day).toBe("2025-12-22");
  expect(result.days).toHaveLength(14);
  expect(result.mine).toBe(3);
  expect(result.groupSessions).toBe(5);
  expect(result.activeWeeks).toBe(1);
  expect(result.days.at(-1)?.future).toBe(true);
});

it("uses the displayed period for totals and fills empty days without fake attendance", () => {
  const result = participationWindow(
    {
      today: "2026-11-26",
      group_count: 2,
      days: [
        { day: "2026-06-01", mine: 3, group_sessions: 4 },
        { day: "2026-11-25", mine: 1, group_sessions: 2 },
      ],
    },
    13,
  );
  expect(result.days).toHaveLength(91);
  expect(result.mine).toBe(1);
  expect(result.groupSessions).toBe(2);
  expect(result.days[0].mine).toBe(0);
  expect(weeklyFrequency(13, 26)).toBe("0,5");
  expect(weeklyFrequency(1, 26)).toBe("<0,1");
  expect(weeklyFrequency(0, 26)).toBe("0");
});
