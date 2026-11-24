"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { CalendarDays, List, MapPin, Clock } from "lucide-react";
import { Calendar } from "./ui/calendar";
import { Badge } from "./ui/badge";
import { SlidingTabs } from "./ui/sliding-tabs";
type Session = {
  id: string;
  title: string;
  venue: string;
  starts_at: string;
  status: string;
};
const dayKey = (instant: string) =>
  new Date(new Date(instant).getTime() + 7 * 3600000)
    .toISOString()
    .slice(0, 10);
export default function SessionBrowser({
  sessions,
  today,
}: {
  sessions: Session[];
  today: string;
}) {
  const [mode, setMode] = useState("calendar");
  const panelId = useId();
  const [day, setDay] = useState<string>();
  const counts: Record<string, number> = {};
  for (const session of sessions) {
    const key = dayKey(session.starts_at);
    counts[key] = (counts[key] || 0) + 1;
  }
  const rows =
    mode === "calendar" && day
      ? sessions.filter((s) => dayKey(s.starts_at) === day)
      : sessions;
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
            <Calendar
              today={today}
              value={day}
              onChange={setDay}
              counts={counts}
            />
            <p className="field-hint">Dấu chấm là ngày có buổi chơi.</p>
          </section>
        )}
        <div className="session-agenda">
          <div className="agenda-heading">
            <h2>
              {mode === "calendar" && day
                ? `Ngày ${day.split("-").reverse().join("/")}`
                : "Các buổi của nhóm"}
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
            <article className="session-agenda-item" key={session.id}>
              <Link href={`/sessions/${session.id}`}>
                <h3>{session.title}</h3>
              </Link>
              <Badge
                tone={
                  session.status === "settled"
                    ? "success"
                    : session.status === "cancelled"
                      ? "danger"
                      : session.status === "played"
                        ? "warning"
                        : "neutral"
                }
              >
                {{
                  planned: "Sắp tới",
                  settled: "Đã thu đủ",
                  cancelled: "Đã hủy",
                  played: "Đang thu tiền",
                }[session.status] || session.status}
              </Badge>
              <p>
                <Clock size={15} />
                {new Date(session.starts_at).toLocaleString("vi-VN", {
                  timeZone: "Asia/Ho_Chi_Minh",
                })}
              </p>
              <p>
                <MapPin size={15} />
                {session.venue}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
