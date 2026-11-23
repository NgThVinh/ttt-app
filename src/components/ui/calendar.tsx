"use client";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthDays, shiftDate, shiftMonth } from "@/lib/calendar";

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00Z").toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
export function Calendar({
  value,
  today,
  onChange,
  counts = {},
}: {
  value?: string;
  today: string;
  onChange: (date: string) => void;
  counts?: Record<string, number>;
}) {
  const [month, setMonth] = useState((value || today).slice(0, 7));
  const [focus, setFocus] = useState(value || today);
  const root = useRef<HTMLDivElement>(null);
  const days = monthDays(month);
  const tabDay = days.includes(focus) ? focus : days.find(Boolean);
  function move(day: string, key: string) {
    const weekday = (new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7;
    const delta: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -weekday,
      End: 6 - weekday,
    };
    let next: string;
    if (key === "PageUp" || key === "PageDown")
      next = shiftMonth(day.slice(0, 7), key === "PageUp" ? -1 : 1) + "-01";
    else if (key in delta) next = shiftDate(day, delta[key]);
    else return false;
    setMonth(next.slice(0, 7));
    setFocus(next);
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)
        ?.focus(),
    );
    return true;
  }
  return (
    <div
      className="calendar"
      ref={root}
      role="group"
      aria-label="Lịch chọn ngày"
    >
      <div className="calendar-heading">
        <button
          type="button"
          aria-label="Tháng trước"
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <strong aria-live="polite">
          Tháng {Number(month.slice(5))}/{month.slice(0, 4)}
        </strong>
        <button
          type="button"
          aria-label="Tháng sau"
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="calendar-week" aria-hidden="true">
        {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="calendar-days">
        {days.map((day, index) =>
          day ? (
            <button
              type="button"
              key={day}
              data-date={day}
              tabIndex={day === tabDay ? 0 : -1}
              aria-pressed={day === value}
              aria-current={day === today ? "date" : undefined}
              aria-label={`${dateLabel(day)}${counts[day] ? `, ${counts[day]} buổi chơi` : ""}`}
              onFocus={() => setFocus(day)}
              onKeyDown={(event) => {
                if (move(day, event.key)) event.preventDefault();
              }}
              onClick={() => onChange(day)}
            >
              {Number(day.slice(8))}
              {!!counts[day] && (
                <span className="calendar-dot" aria-hidden="true" />
              )}
            </button>
          ) : (
            <span key={`blank-${index}`} />
          ),
        )}
      </div>
      <button
        className="calendar-today"
        type="button"
        onClick={() => {
          setMonth(today.slice(0, 7));
          setFocus(today);
          onChange(today);
        }}
      >
        Hôm nay
      </button>
    </div>
  );
}
