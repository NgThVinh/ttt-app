import { z } from "zod";

const localTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .transform((v) => v + ":00+07:00")
  .pipe(z.iso.datetime({ offset: true }));
export const meetingSchema = z
  .object({
    groupId: z.uuid(),
    title: z.string().trim().min(1).max(160),
    venue: z.string().trim().min(1).max(200),
    starts: localTime,
    ends: localTime,
    note: z.string().trim().max(2000),
    collectorMode: z.enum(["unknown", "self", "nominee"]),
    nominee: z.uuid().or(z.literal("")),
    invitees: z
      .array(z.uuid())
      .max(100)
      .refine((v) => new Set(v).size === v.length),
    request_key: z.uuid(),
    repeatWeeks: z.coerce.number().int().min(0).max(12).default(0),
  })
  .refine(
    (v) =>
      Date.parse(v.ends) > Date.parse(v.starts) &&
      Date.parse(v.ends) <= Date.parse(v.starts) + 7 * 86400000,
    {
      message: "Giờ kết thúc phải sau giờ bắt đầu, tối đa 7 ngày.",
      path: ["ends"],
    },
  )
  .refine((v) => v.collectorMode !== "nominee" || !!v.nominee, {
    message: "Chọn người được đề cử tính tiền.",
    path: ["nominee"],
  });
