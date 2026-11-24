import { z } from "zod";

const reason = z.string().trim().min(1).max(500);
const metadata = z
  .object({
    title: z.string().trim().min(1).max(160),
    venue: z.string().trim().min(1).max(200),
    note: z.string().trim().max(2000),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }).optional(),
    commit_deadline: z.iso.datetime({ offset: true }),
    reason,
  })
  .strict()
  .refine((p) => Date.parse(p.commit_deadline) <= Date.parse(p.starts_at), {
    message: "Hạn chốt cần không muộn hơn giờ bắt đầu.",
  })
  .refine(
    (p) => !p.ends_at || Date.parse(p.ends_at) > Date.parse(p.starts_at),
    { message: "Giờ kết thúc phải sau giờ bắt đầu." },
  );

export const sessionCalendarSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("edit"), body: metadata }).strict(),
  z.object({ operation: z.literal("reopen"), body: metadata }).strict(),
  z
    .object({
      operation: z.literal("cancel"),
      body: z.object({ reason }).strict(),
    })
    .strict(),
]);

export const sessionCalendarFormSchema = z.object({
  sid: z.uuid(),
  revision: z.string().regex(/^\d+$/),
});

export type SessionCalendarInput = z.infer<typeof sessionCalendarSchema>;
