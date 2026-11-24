"use client";
import { useEffect, useState } from "react";
import { CalendarDays, Clock3, MapPin, Pencil } from "lucide-react";
import type { SessionDetail } from "@/lib/session-data";
import {
  sessionDate,
  sessionTime,
  sessionStatus,
  sessionDay,
} from "@/lib/session-overview";
import SessionCalendarForm from "./session-calendar-form";
import SessionHistory from "./session-history";
import ShareButton from "./share-button";
import { sessionCountdown } from "@/lib/session-countdown";
export default function SessionHeader({
  session: s,
  note,
  canCancel,
  now,
}: {
  session: SessionDetail;
  note: string | null;
  canCancel: boolean;
  now: number;
}) {
  const [editing, setEditing] = useState(false),
    [clock, setClock] = useState(now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const canEdit =
    (s.status === "planned" || s.status === "cancelled") && !s.calendar_locked;
  return (
    <section className="session-hero">
      <div className="hero-top">
        <span className="status">{sessionStatus[s.status]}</span>
        <div className="actions">
          {canEdit && (
            <button
              className="secondary"
              type="button"
              aria-label={
                editing
                  ? "Hủy sửa"
                  : s.status === "cancelled"
                    ? "Mở lại buổi"
                    : "Sửa thông tin buổi"
              }
              aria-expanded={editing}
              onClick={() => setEditing(!editing)}
            >
              <Pencil size={16} />
              {editing
                ? "Hủy sửa"
                : s.status === "cancelled"
                  ? "Mở lại buổi"
                  : "Sửa"}
            </button>
          )}
          <SessionHistory sid={s.id} />
          <ShareButton
            title={s.title}
            text={`${s.title} tại ${s.venue}. Xem lịch và nhận lời tham gia trong app.`}
            path={`/sessions/${s.id}`}
          />
        </div>
      </div>
      {editing ? (
        <SessionCalendarForm
          key={s.revision}
          session={s}
          note={note}
          canCancel={canCancel}
          onSaved={() => setEditing(false)}
        />
      ) : (
        <>
          <h1>{s.title}</h1>
          <div className="hero-information">
            <div>
              <CalendarDays aria-hidden="true" />
              <div>
                <strong>{sessionDate(s.starts_at)}</strong>
                <span>
                  {new Date(s.starts_at).toLocaleDateString("vi-VN", {
                    year: "numeric",
                    timeZone: "Asia/Ho_Chi_Minh",
                  })}
                </span>
              </div>
            </div>
            <div>
              <Clock3 aria-hidden="true" />
              <div>
                <strong>
                  {sessionTime(s.starts_at)}
                  {s.ends_at ? ` – ${sessionTime(s.ends_at)}` : ""}
                </strong>
                <span>
                  {sessionCountdown(s.starts_at, s.ends_at, s.status, clock)}
                </span>
                {s.ends_at &&
                  sessionDay(s.ends_at) !== sessionDay(s.starts_at) && (
                    <small>Kết thúc {sessionDate(s.ends_at)}</small>
                  )}
              </div>
            </div>
            <div>
              <MapPin aria-hidden="true" />
              <div>
                <strong>{s.venue}</strong>
                <span>Địa điểm</span>
              </div>
            </div>
          </div>
          {note && <p className="hero-note">{note}</p>}
        </>
      )}
    </section>
  );
}
