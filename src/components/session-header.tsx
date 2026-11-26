"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock3, MapPin, Pencil, Trash2 } from "lucide-react";
import SessionTask from "./session-task";
import ActionForm from "./action-form";
import { deleteSession } from "@/app/sessions/actions";
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
  const startPassed = clock >= Date.parse(s.starts_at),
    endPassed = !!s.ends_at && clock >= Date.parse(s.ends_at);
  const statusLabel =
    s.status === "planned"
      ? endPassed
        ? "Chờ chốt chi phí"
        : startPassed
          ? "Đang diễn ra"
          : sessionStatus[s.status]
      : sessionStatus[s.status];
  const canEdit =
    (s.status === "planned" || s.status === "cancelled") && !s.calendar_locked;
  const endOtherDay =
    s.ends_at && sessionDay(s.ends_at) !== sessionDay(s.starts_at);
  const [year, month, day] = sessionDay(s.starts_at).split("-");
  return (
    <header className="session-hero">
      <div className="session-page-tools">
        <Link href="/sessions" scroll={false}>
          <ArrowLeft size={16} aria-hidden="true" />
          Buổi chơi
        </Link>
        <div className="actions hero-tools">
          {canEdit && (
            <button
              className="secondary"
              type="button"
              title={
                editing
                  ? "Hủy sửa"
                  : s.status === "cancelled"
                    ? "Mở lại buổi"
                    : "Sửa thông tin buổi"
              }
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
              <Pencil size={17} aria-hidden="true" />
            </button>
          )}
          <SessionHistory sid={s.id} />
          {canCancel &&
            (s.status === "planned" || s.status === "cancelled") &&
            !s.booking_locked && (
              <SessionTask
                label={<Trash2 size={17} aria-hidden="true" />}
                accessibleLabel="Xóa buổi chưa chốt"
                title="Xóa buổi chơi"
                secondary
              >
                <p>Xóa “{s.title}” khỏi lịch? Các buổi lặp khác giữ nguyên.</p>
                <ActionForm action={deleteSession} label="Xóa buổi chơi">
                  <input type="hidden" name="sid" value={s.id} />
                  <input type="hidden" name="revision" value={s.revision} />
                  <label className="delete-session-confirm">
                    <input
                      type="checkbox"
                      name="reviewed"
                      value="yes"
                      required
                    />
                    Tôi xác nhận xóa riêng buổi này.
                  </label>
                </ActionForm>
              </SessionTask>
            )}
          <ShareButton
            compact
            title={s.title}
            text={
              s.title +
              " tại " +
              s.venue +
              ". Xem lịch và nhận lời tham gia trong app."
            }
            path={"/sessions/" + s.id}
          />
        </div>
      </div>
      <section className="session-overview" aria-label="Thông tin buổi chơi">
        <div className="session-date-tile" aria-hidden="true">
          <span>Tháng {Number(month)}</span>
          <strong>{Number(day)}</strong>
          <small>{year}</small>
        </div>
        <div className="hero-titles">
          <div className="hero-state">
            <span className="status" data-state={s.status}>
              {statusLabel}
            </span>
            {s.status === "planned" && !startPassed && (
              <span className="hero-countdown">
                {sessionCountdown(s.starts_at, s.ends_at, s.status, clock)}
              </span>
            )}
          </div>
          <h1>{s.title}</h1>
          {!editing && (
            <>
              <div className="hero-information">
                <div className="hero-schedule">
                  <Clock3 size={17} aria-hidden="true" />
                  <strong>
                    {sessionDate(s.starts_at)} · {sessionTime(s.starts_at)}
                    {s.ends_at ? "–" + sessionTime(s.ends_at) : ""}
                  </strong>
                </div>
                <div className="hero-place">
                  <MapPin size={17} aria-hidden="true" />
                  <span>{s.venue}</span>
                </div>
              </div>
              {endOtherDay && (
                <small className="hero-end-date">
                  Kết thúc {sessionDate(s.ends_at!)}
                </small>
              )}
              {note &&
                (note.length > 100 ? (
                  <details className="hero-note">
                    <summary>Ghi chú của buổi</summary>
                    <p>{note}</p>
                  </details>
                ) : (
                  <p className="hero-note">{note}</p>
                ))}
            </>
          )}
        </div>
      </section>
      {editing && (
        <SessionCalendarForm
          key={s.revision}
          session={s}
          note={note}
          canCancel={canCancel}
          onSaved={() => setEditing(false)}
        />
      )}
    </header>
  );
}
