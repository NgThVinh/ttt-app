import { sessionDay, type SessionOverview } from "./session-overview";

export type CalendarPoll = {
  id: string;
  title: string;
  venue: string;
  closes_at: string;
  group_name: string;
  options: { id: string; starts_at: string; ends_at: string }[];
};
export type DayMarkers = {
  joined: number;
  confirmed: number;
  voting: number;
  tentative: number;
};
export type CalendarMarkers = Record<string, DayMarkers>;

export function calendarMarkers(
  sessions: SessionOverview[],
  polls: CalendarPoll[],
): CalendarMarkers {
  const days: CalendarMarkers = {};
  const at = (date: string) =>
    (days[date] ||= { joined: 0, confirmed: 0, voting: 0, tentative: 0 });
  for (const s of sessions) {
    if (s.status === "cancelled") continue;
    const mark = at(sessionDay(s.starts_at));
    if (s.my_rsvp === "going") mark.joined++;
    if (s.schedule_confirmed || s.status === "played" || s.status === "settled")
      mark.confirmed++;
    else mark.tentative++;
  }
  for (const poll of polls) {
    // Several time options on one date still represent one poll.
    for (const day of new Set(poll.options.map((o) => sessionDay(o.starts_at))))
      at(day).voting++;
  }
  return days;
}

export function markerLabel(mark?: DayMarkers) {
  if (!mark) return "";
  return [
    mark.joined && `${mark.joined} buổi bạn tham gia`,
    mark.confirmed && `${mark.confirmed} lịch đã chốt`,
    mark.voting && `${mark.voting} thăm dò đang vote`,
    mark.tentative && `${mark.tentative} lịch dự kiến`,
  ]
    .filter(Boolean)
    .join(", ");
}

export function markerStates(mark?: DayMarkers) {
  return mark
    ? [
        mark.joined && "joined",
        mark.confirmed && "confirmed",
        mark.voting && "voting",
        mark.tentative && "tentative",
      ]
        .filter(Boolean)
        .join(" ")
    : "";
}
