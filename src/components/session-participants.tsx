"use client";
import { useState } from "react";
import type { SessionDetail } from "@/lib/session-data";
import RsvpButtons from "./rsvp-buttons";
type Person = SessionDetail["attendees"][number];
function Names({ people }: { people: Person[] }) {
  const [expanded, setExpanded] = useState(false),
    visible = expanded ? people : people.slice(0, 8);
  return (
    <>
      <span className="roster-names">
        {visible.map((p, i) => (
          <span key={p.member_id}>
            {i > 0 ? ", " : ""}
            {p.name}
            {Number(p.weight) !== 1 && <small> ×{p.weight}</small>}
          </span>
        ))}
      </span>
      {people.length > 8 && (
        <button
          className="roster-more"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Thu gọn" : `+ ${people.length - 8} người`}
        </button>
      )}
    </>
  );
}
export default function SessionParticipants({
  session: s,
  children,
}: {
  session: SessionDetail;
  children?: React.ReactNode;
}) {
  const people = s.attendees.filter((p) => !p.removed_at),
    going = people.filter((p) => p.rsvp === "going" && p.committed_at),
    waiting = people.filter(
      (p) => p.rsvp !== "not_going" && !(p.rsvp === "going" && p.committed_at),
    ),
    declined = people.filter((p) => p.rsvp === "not_going"),
    mine = people.find((p) => p.member_id === s.my_member_id);
  const choice =
    mine?.rsvp === "going" && mine.committed_at
      ? "going"
      : mine?.rsvp === "not_going"
        ? "not_going"
        : "pending";
  return (
    <section
      className="panel session-participants"
      aria-labelledby="participants-title"
    >
      <div className="section-heading">
        <h2 id="participants-title">Người tham gia</h2>
        {children}
      </div>
      {s.status === "planned" ? (
        <div className={`my-attendance ${choice}`}>
          <div>
            <strong>
              {choice === "going"
                ? "Bạn đã nhận lời"
                : choice === "not_going"
                  ? "Bạn chọn không đi"
                  : "Bạn có tham gia?"}
            </strong>
          </div>
          <RsvpButtons
            key={s.revision}
            sid={s.id}
            revision={s.revision}
            value={choice}
          />
        </div>
      ) : (
        <p className="attendance-final">
          {s.status === "cancelled"
            ? "Buổi đã hủy; không phát sinh cam kết mới"
            : choice === "going"
              ? "Bạn đã tham gia"
              : choice === "not_going"
                ? "Bạn không tham gia"
                : "Bạn không có tên trong buổi này"}
        </p>
      )}
      <div className="attendance-groups">
        <div className="roster-row going">
          <h3>
            <span>{going.length}</span>Đã nhận lời
          </h3>
          {going.length ? (
            <Names people={going} />
          ) : (
            <span className="roster-empty">Chưa có ai</span>
          )}
        </div>
        {!!waiting.length && (
          <div className="roster-row waiting">
            <h3>
              <span>{waiting.length}</span>Đang chờ
            </h3>
            <Names people={waiting} />
          </div>
        )}
        {!!declined.length && (
          <div className="roster-row declined">
            <h3>
              <span>{declined.length}</span>Không đi
            </h3>
            <Names people={declined} />
          </div>
        )}
      </div>
      {s.booking_locked && s.status !== "cancelled" && (
        <p className="booking-lock">
          Đã chốt chi phí · Lịch và danh sách tham gia đã khóa.
        </p>
      )}
    </section>
  );
}
