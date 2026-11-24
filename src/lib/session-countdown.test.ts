import { it, expect } from "vitest";
import { sessionCountdown } from "./session-countdown";
it("shows relative time and session lifecycle without rounding down to zero", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  expect(sessionCountdown("2026-11-26T13:00:00Z", null, "planned", now)).toBe(
    "Còn 2 ngày 1 giờ",
  );
  expect(sessionCountdown("2026-11-24T12:00:10Z", null, "planned", now)).toBe(
    "Còn 1 phút",
  );
  expect(
    sessionCountdown(
      "2026-11-24T11:00:00Z",
      "2026-11-24T13:00:00Z",
      "planned",
      now,
    ),
  ).toBe("Đang diễn ra");
  expect(
    sessionCountdown(
      "2026-11-24T10:00:00Z",
      "2026-11-24T11:00:00Z",
      "played",
      now,
    ),
  ).toBe("Đã kết thúc");
  expect(sessionCountdown("2026-11-24T10:00:00Z", null, "cancelled", now)).toBe(
    "Buổi đã hủy",
  );
});
