import { expect, it } from "vitest";
import { monthDays, shiftDate, shiftMonth, vietnamToday } from "./calendar";
it("uses Monday first and handles leap years and year boundaries", () => {
  expect(monthDays("2024-02").filter(Boolean)).toHaveLength(29);
  expect(monthDays("2025-02").filter(Boolean)).toHaveLength(28);
  expect(monthDays("2026-11")[6]).toBe("2026-11-01");
  expect(shiftDate("2024-03-01", -1)).toBe("2024-02-29");
  expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  expect(vietnamToday(new Date("2026-11-23T18:00:00Z"))).toBe("2026-11-24");
});
