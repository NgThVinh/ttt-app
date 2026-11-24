"use client";
import { useId, useState } from "react";
import { CalendarDays, List, ChevronLeft, ChevronRight } from "lucide-react";
import { Calendar } from "./ui/calendar";
import { SlidingTabs } from "./ui/sliding-tabs";
import SessionListItem from "./session-list-item";
import { shiftDate } from "@/lib/calendar";
import {
  sessionDay as dayKey,
  type SessionOverview,
} from "@/lib/session-overview";
export default function SessionBrowser({
  sessions,
  today,
}: {
  sessions: SessionOverview[];
  today: string;
}) {
  const [mode, setMode] = useState("calendar");
  const showGroup = new Set(sessions.map((s) => s.group_name)).size > 1;
  const panelId = useId();
  const [day, setDay] = useState<string>();
  const [week, setWeek] = useState(today);
  const [monthOpen, setMonthOpen] = useState(false);
  const weekday = (new Date(week + "T12:00:00Z").getUTCDay() + 6) % 7;
  const weekStart = shiftDate(week, -weekday);
  const counts: Record<string, number> = {};
  for (const session of sessions) {
    const key = dayKey(session.starts_at);
    counts[key] = (counts[key] || 0) + 1;
  }
  const filtered =
    mode === "calendar" && day
      ? sessions.filter((s) => dayKey(s.starts_at) === day)
      : sessions;
  const rows = [...filtered].sort((a, b) => {
    const aPast = dayKey(a.starts_at) < today,
      bPast = dayKey(b.starts_at) < today;
    if (aPast !== bPast) return aPast ? 1 : -1;
    return aPast
      ? b.starts_at.localeCompare(a.starts_at)
      : a.starts_at.localeCompare(b.starts_at);
  });
  return (
    <section className="session-browser">
      <SlidingTabs
        value={mode}
        onChange={setMode}
        panelId={panelId}
        label="Cách xem buổi chơi"
        className="view-switch"
        options={[
          {
            value: "calendar",
            label: "Lịch tháng",
            icon: <CalendarDays size={18} aria-hidden="true" />,
          },
          {
            value: "list",
            label: "Danh sách",
            icon: <List size={18} aria-hidden="true" />,
          },
        ]}
      />
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${panelId}-${mode}`}
        tabIndex={0}
        className={mode === "calendar" ? "calendar-layout" : ""}
      >
        {mode === "calendar" && (
          <section className="calendar-card">
            <div className="mobile-week">
              <div className="week-toolbar">
                <button
                  type="button"
                  className="secondary"
                  aria-label="Tuần trước"
                  onClick={() => setWeek(shiftDate(week, -7))}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-expanded={monthOpen}
                  aria-label={monthOpen ? "Thu gọn lịch" : "Xem lịch tháng"}
                  aria-controls={`${panelId}-month`}
                  onClick={() => setMonthOpen(!monthOpen)}
                >
                  <CalendarDays size={16} aria-hidden />
                  {weekStart.slice(5).split("-").reverse().join("/")}–
                  {shiftDate(weekStart, 6)
                    .slice(5)
                    .split("-")
                    .reverse()
                    .join("/")}
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-label="Tuần sau"
                  onClick={() => setWeek(shiftDate(week, 7))}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              <div className="week-days" aria-label="Lịch tuần">
                {Array.from({ length: 7 }, (_, i) => {
                  const d = shiftDate(weekStart, i);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={day === d}
                      aria-current={d === today ? "date" : undefined}
                      aria-label={`${d.split("-").reverse().join("/")}, ${counts[d] || 0} buổi`}
                      onClick={() => setDay(day === d ? undefined : d)}
                    >
                      <small>
                        {["T2", "T3", "T4", "T5", "T6", "T7", "CN"][i]}
                      </small>
                      <strong>{Number(d.slice(8))}</strong>
                      <span
                        className={counts[d] ? "week-dot filled" : "week-dot"}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
            <div
              className={`month-calendar${monthOpen ? " is-open" : ""}`}
              id={`${panelId}-month`}
            >
              <Calendar
                today={today}
                value={day}
                onChange={setDay}
                counts={counts}
              />
            </div>
          </section>
        )}
        <div className="session-agenda">
          <div className="agenda-heading">
            <h2>
              {mode === "calendar" && day
                ? `Ngày ${day.split("-").reverse().join("/")}`
                : "Lịch của nhóm"}
            </h2>
            {day && mode === "calendar" && (
              <button
                type="button"
                className="secondary"
                onClick={() => setDay(undefined)}
              >
                Xem tất cả
              </button>
            )}
          </div>
          {!rows.length && (
            <p>
              {!sessions.length
                ? "Chưa có buổi chơi. Tạo buổi đầu tiên để hiện trên lịch."
                : "Chưa có buổi chơi trong ngày này."}
            </p>
          )}
          {rows.map((session) => (
            <SessionListItem
              key={session.id}
              session={session}
              showGroup={showGroup}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
