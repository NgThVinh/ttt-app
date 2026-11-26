import { z } from "zod";
import { shiftDate } from "./calendar";

export const activitySchema = z.object({
  today: z.iso.date(),
  group_count: z.number().int().nonnegative(),
  days: z.array(
    z.object({
      day: z.iso.date(),
      mine: z.number().int().nonnegative(),
      group_sessions: z.number().int().nonnegative(),
    }),
  ),
});
export type ParticipationActivity = z.infer<typeof activitySchema>;

export function participationWindow(
  data: ParticipationActivity,
  weeks: number,
) {
  const weekday = (new Date(data.today + "T12:00:00Z").getUTCDay() + 6) % 7;
  const first = shiftDate(data.today, -weekday - (weeks - 1) * 7);
  const lookup = new Map(data.days.map((d) => [d.day, d]));
  const days = Array.from({ length: weeks * 7 }, (_, i) => {
    const day = shiftDate(first, i);
    const source = lookup.get(day);
    return {
      day,
      mine: source?.mine || 0,
      group_sessions: source?.group_sessions || 0,
      future: day > data.today,
    };
  });
  const past = days.filter((d) => !d.future);
  return {
    days,
    mine: past.reduce((n, d) => n + d.mine, 0),
    groupSessions: past.reduce((n, d) => n + d.group_sessions, 0),
    activeWeeks: new Set(
      past.flatMap((d, i) => (d.mine ? [Math.floor(i / 7)] : [])),
    ).size,
  };
}

export function weeklyFrequency(total: number, weeks: number) {
  if (total > 0 && total / weeks < 0.1) return "<0,1";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(
    total / weeks,
  );
}
