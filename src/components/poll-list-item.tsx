import Link from "next/link";
import { MapPin } from "lucide-react";
import { Badge } from "./ui/badge";
import type { CalendarPoll } from "@/lib/calendar-overview";
import { sessionDate, sessionTime } from "@/lib/session-overview";

export default function PollListItem({
  poll,
  option,
  showGroup,
}: {
  poll: CalendarPoll;
  option: CalendarPoll["options"][number];
  showGroup: boolean;
}) {
  return (
    <article className="session-agenda-item agenda-row poll-agenda-item">
      <div className="agenda-time">
        <time dateTime={option.starts_at}>{sessionDate(option.starts_at)}</time>
        <strong>{sessionTime(option.starts_at)}</strong>
        <small>– {sessionTime(option.ends_at)}</small>
      </div>
      <div className="agenda-info">
        <Link href={`/polls/${poll.id}`}>
          <h3>{poll.title}</h3>
        </Link>
        <p className="inline-meta">
          <span>
            <MapPin size={14} aria-hidden />
            {poll.venue}
          </span>
        </p>
        {showGroup && <small className="agenda-group">{poll.group_name}</small>}
      </div>
      <div className="agenda-actions">
        <Badge tone="warning">Đang vote</Badge>
        <Link className="quiet-link" href={`/polls/${poll.id}`}>
          Chọn khung giờ
        </Link>
      </div>
    </article>
  );
}
