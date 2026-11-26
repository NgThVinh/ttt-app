import { sessionDay, type SessionOverview } from "./session-overview";

export type DayMarkers = {
  joined: number;
  confirmed: number;
  tentative: number;
};
export type CalendarMarkers = Record<string, DayMarkers>;

export function calendarMarkers(sessions: SessionOverview[]): CalendarMarkers {
  const days: CalendarMarkers = {};
  const at = (date: string) =>
    (days[date] ||= { joined: 0, confirmed: 0, tentative: 0 });
  for (const s of sessions) {
    if (s.status === "cancelled") continue;
    const mark = at(sessionDay(s.starts_at));
    if (s.my_rsvp === "going") mark.joined++;
    if (s.schedule_confirmed || s.status === "played" || s.status === "settled")
      mark.confirmed++;
    else mark.tentative++;
  }
  return days;
}

export function markerLabel(mark?: DayMarkers) {
  if (!mark) return "";
  return [
    mark.joined && `${mark.joined} buổi bạn tham gia`,
    mark.confirmed && `${mark.confirmed} lịch đã chốt`,
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
        mark.tentative && "tentative",
      ]
        .filter(Boolean)
        .join(" ")
    : "";
}
