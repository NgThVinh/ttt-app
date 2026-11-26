"use client";
import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  SessionWorkspaceLink,
  useSessionWorkspace,
} from "./session-workspace-shell";
import { Calendar } from "./ui/calendar";
import SessionListItem from "./session-list-item";
import { CalendarDayMarks, CalendarLegend } from "./ui/calendar-markers";
import {
  calendarMarkers,
  markerLabel,
  markerStates,
} from "@/lib/calendar-overview";
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
  const showGroup = new Set([...sessions.map((s) => s.group_name)]).size > 1;
  const panelId = useId();
  const [localDay, setLocalDay] = useState<string>();
  const workspace = useSessionWorkspace();
  const day = workspace ? workspace.day : localDay;
  const setDay = workspace?.setDay || setLocalDay;
  const [week, setWeek] = useState(today);
  const [monthOpen, setMonthOpen] = useState(false);
  const card = useRef<HTMLElement>(null);
  const monthToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!monthOpen) return;
    const outside = (event: PointerEvent) => {
      if (!card.current?.contains(event.target as Node)) setMonthOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [monthOpen]);
  const weekday = (new Date(week + "T12:00:00Z").getUTCDay() + 6) % 7;
  const weekStart = shiftDate(week, -weekday);
  const markers = calendarMarkers(sessions);
  const counts: Record<string, number> = {};
  for (const session of sessions) {
    const key = dayKey(session.starts_at);
    counts[key] = (counts[key] || 0) + 1;
  }
  const rows = day
    ? sessions.filter((s) => dayKey(s.starts_at) === day)
    : sessions;
  const items = [...rows].sort((a, b) => {
    const ap = dayKey(a.starts_at) < today,
      bp = dayKey(b.starts_at) < today;
    return ap !== bp
      ? ap
        ? 1
        : -1
      : ap
        ? b.starts_at.localeCompare(a.starts_at)
        : a.starts_at.localeCompare(b.starts_at);
  });
  return (
    <section className="session-browser">
      <div className="calendar-layout">
        <section
          className={`calendar-card${monthOpen ? " month-expanded" : ""}`}
          ref={card}
          onKeyDown={(event) => {
            if (event.key === "Escape" && monthOpen) {
              setMonthOpen(false);
              monthToggle.current?.focus();
            }
          }}
        >
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
                ref={monthToggle}
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
                    data-date={d}
                    data-calendar-states={markerStates(markers[d])}
                    aria-label={`${d.split("-").reverse().join("/")}, ${markerLabel(markers[d]) || "Chưa có lịch"}`}
                    onClick={() => setDay(day === d ? undefined : d)}
                  >
                    <small>
                      {["T2", "T3", "T4", "T5", "T6", "T7", "CN"][i]}
                    </small>
                    <strong>{Number(d.slice(8))}</strong>
                    <CalendarDayMarks mark={markers[d]} />
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
              onChange={(d) => {
                setDay(d);
                setMonthOpen(false);
                if (monthOpen) monthToggle.current?.focus();
              }}
              counts={counts}
              markers={markers}
            />
          </div>
          <CalendarLegend />
        </section>
        <div className="session-agenda">
          <div className="agenda-heading">
            <h2>
              {day
                ? `Ngày ${day.split("-").reverse().join("/")}`
                : "Lịch của nhóm"}
            </h2>
            {day && (
              <button
                type="button"
                className="secondary"
                onClick={() => setDay(undefined)}
              >
                Xem tất cả
              </button>
            )}
          </div>
          <div
            className="agenda-items"
            role="region"
            aria-label="Danh sách buổi chơi"
            tabIndex={0}
            data-scroll="agenda"
          >
            {!items.length && (
              <p>
                {!sessions.length
                  ? "Chưa có buổi chơi. Tạo buổi đầu tiên để hiện trên lịch."
                  : "Chưa có buổi chơi trong ngày này."}
              </p>
            )}
            {items.map((session) => (
              <SessionListItem
                key={session.id}
                session={session}
                showGroup={showGroup}
              />
            ))}
            <SessionWorkspaceLink create className="calendar-create-row">
              <Plus size={19} aria-hidden="true" />
              {day
                ? `Tạo buổi ngày ${day.split("-").reverse().join("/")}`
                : "Tạo buổi chơi mới"}
            </SessionWorkspaceLink>
          </div>
        </div>
      </div>
    </section>
  );
}
