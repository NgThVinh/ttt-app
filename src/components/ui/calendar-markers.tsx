import type { DayMarkers } from "@/lib/calendar-overview";

export function CalendarDayMarks({ mark }: { mark?: DayMarkers }) {
  if (!mark) return null;
  return (
    <span className="calendar-marks" aria-hidden="true">
      {!!mark.joined && <span className="day-mark joined">✓</span>}
      {!!mark.confirmed && <span className="day-mark confirmed">■</span>}
      {!!mark.voting && <span className="day-mark voting">◆</span>}
      {!!mark.tentative && !mark.joined && (
        <span className="day-mark tentative">•</span>
      )}
    </span>
  );
}

export function CalendarLegend() {
  return (
    <div className="calendar-legend" aria-label="Chú giải lịch">
      <span>
        <i className="day-mark joined" aria-hidden>
          ✓
        </i>
        Bạn tham gia
      </span>
      <span title="Thăm dò đã chốt hoặc buổi đã chốt chi phí">
        <i className="day-mark confirmed" aria-hidden>
          ■
        </i>
        Lịch đã chốt
      </span>
      <span>
        <i className="day-mark voting" aria-hidden>
          ◆
        </i>
        Đang vote
      </span>
      <span>
        <i className="day-mark tentative" aria-hidden>
          •
        </i>
        Lịch dự kiến
      </span>
    </div>
  );
}
