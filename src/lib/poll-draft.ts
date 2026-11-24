import { z } from "zod";
export const pollDraftSchema = z.object({
  pollId: z.uuid(),
  optionId: z.uuid(),
  groupId: z.uuid(),
  title: z.string(),
  venue: z.string(),
  starts: z.iso.datetime({ offset: true }),
  ends: z.iso.datetime({ offset: true }),
  invitees: z.array(z.uuid()),
});
export type PollMeetingDraft = z.infer<typeof pollDraftSchema>;
export function pollStatus(
  status: string,
  closesAt: string,
  hasSession: boolean,
  now: number,
) {
  return hasSession
    ? "Đã tạo buổi"
    : status === "closed"
      ? "Đã đóng"
      : Date.parse(closesAt) <= now
        ? "Đã hết hạn"
        : "Đang thăm dò";
}
export function pollLocalTime(instant: string) {
  return new Date(Date.parse(instant) + 7 * 3600000).toISOString().slice(0, 16);
}
