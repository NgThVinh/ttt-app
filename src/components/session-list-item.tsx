import Link from "next/link";
import { MapPin } from "lucide-react";
import { Badge } from "./ui/badge";
import RsvpButtons from "./rsvp-buttons";
import AttendancePreview from "./attendance-preview";
import {
  sessionDate,
  sessionTime,
  sessionStatus,
  type SessionOverview,
} from "@/lib/session-overview";

export default function SessionListItem({
  session: s,
  showGroup = true,
}: {
  session: SessionOverview;
  showGroup?: boolean;
}) {
  return (
    <article className="session-agenda-item agenda-row">
      <div className="agenda-time">
        <time dateTime={s.starts_at}>{sessionDate(s.starts_at)}</time>
        <strong>{sessionTime(s.starts_at)}</strong>
        {s.ends_at && <small>– {sessionTime(s.ends_at)}</small>}
      </div>
      <div className="agenda-info">
        <Link href={`/sessions/${s.id}`}>
          <h3>{s.title}</h3>
        </Link>
        <p className="inline-meta">
          <span>
            <MapPin size={14} aria-hidden />
            {s.venue || "Chưa chọn sân"}
          </span>
          {s.going !== undefined && (
            <AttendancePreview
              going={s.going}
              pending={s.pending || 0}
              goingNames={s.going_names}
              pendingNames={s.pending_names}
            />
          )}
        </p>
        {showGroup && s.group_name && (
          <small className="agenda-group">{s.group_name}</small>
        )}
      </div>
      <div className="agenda-actions">
        {s.status !== "planned" && (
          <Badge
            tone={
              s.status === "settled"
                ? "success"
                : s.status === "played"
                  ? "warning"
                  : s.status === "cancelled"
                    ? "danger"
                    : "neutral"
            }
          >
            {sessionStatus[s.status] || s.status}
          </Badge>
        )}
        {s.status === "planned" && s.revision && (
          <RsvpButtons
            key={`${s.id}-${s.revision}`}
            sid={s.id}
            revision={s.revision}
            value={s.my_rsvp}
          />
        )}
      </div>
    </article>
  );
}
