"use client";
import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, List, ChevronLeft, ChevronRight } from "lucide-react";
import { Calendar } from "./ui/calendar";
import { SlidingTabs } from "./ui/sliding-tabs";
import SessionListItem from "./session-list-item";
import PollListItem from "./poll-list-item";
import { CalendarDayMarks, CalendarLegend } from "./ui/calendar-markers";
import {
  calendarMarkers,
  markerLabel,
  markerStates,
  type CalendarPoll,
} from "@/lib/calendar-overview";
import { shiftDate } from "@/lib/calendar";
import {
  sessionDay as dayKey,
  type SessionOverview,
} from "@/lib/session-overview";
export default function SessionBrowser({
  sessions,
  today,
  polls = [],
  pollsError = false,
}: {
  sessions: SessionOverview[];
  today: string;
  polls?: CalendarPoll[];
  pollsError?: boolean;
}) {
  const [mode, setMode] = useState("calendar");
  const showGroup =
    new Set([
      ...sessions.map((s) => s.group_name),
      ...polls.map((p) => p.group_name),
    ]).size > 1;
  const panelId = useId();
  const [day, setDay] = useState<string>();
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
  const markers = calendarMarkers(sessions, polls);
  const counts: Record<string, number> = {};
  for (const session of sessions) {
    const key = dayKey(session.starts_at);
    counts[key] = (counts[key] || 0) + 1;
  }
  const rows =
    mode === "calendar" && day
      ? sessions.filter((s) => dayKey(s.starts_at) === day)
      : sessions;
  const pollSlots = polls.flatMap((poll) =>
    poll.options
      .filter(
        (option) =>
          mode !== "calendar" || !day || dayKey(option.starts_at) === day,
      )
      .map((option) => ({ poll, option })),
  );
  const items = [
    ...rows.map((session) => ({
      kind: "session" as const,
      session,
      starts: session.starts_at,
    })),
    ...pollSlots.map(({ poll, option }) => ({
      kind: "poll" as const,
      poll,
      option,
      starts: option.starts_at,
    })),
  ].sort((a, b) => {
    const aPast = dayKey(a.starts) < today,
      bPast = dayKey(b.starts) < today;
    return aPast !== bPast
      ? aPast
        ? 1
        : -1
      : aPast
        ? b.starts.localeCompare(a.starts)
        : a.starts.localeCompare(b.starts);
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
        className={mode === "calendar" ? "calendar-layout" : "agenda-layout"}
      >
        {mode === "calendar" && (
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
          <div
            className="agenda-items"
            role="region"
            aria-label="Danh sách buổi chơi và thăm dò"
            tabIndex={0}
            data-scroll="agenda"
          >
            {pollsError && (
              <p role="alert">
                Chưa tải được lịch đang vote. Hãy tải lại để xem đủ lịch nhóm.
              </p>
            )}
            {!items.length && (
              <p>
                {!sessions.length && !polls.length
                  ? "Chưa có buổi chơi. Tạo buổi đầu tiên để hiện trên lịch."
                  : "Chưa có buổi chơi trong ngày này."}
              </p>
            )}
            {items.map((item) =>
              item.kind === "session" ? (
                <SessionListItem
                  key={item.session.id}
                  session={item.session}
                  showGroup={showGroup}
                />
              ) : (
                <PollListItem
                  key={item.option.id}
                  poll={item.poll}
                  option={item.option}
                  showGroup={showGroup}
                />
              ),
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
