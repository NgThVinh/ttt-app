import { z } from "zod";
export const moneySchema = z
  .string()
  .regex(/^-?\d+$/, "Nhập số tiền nguyên")
  .refine(
    (v) =>
      /^-?\d+$/.test(v) &&
      BigInt(v) >= -9223372036854775808n &&
      BigInt(v) <= 9223372036854775807n,
    "Số tiền vượt giới hạn",
  );
export const expenseSchema = z.object({
  title: z.string().trim().min(1).max(160),
  amount: moneySchema,
  amountMode: z.enum(["total", "per_person"]),
  splitMode: z.enum(["equal", "weighted", "exact", "percent"]),
  payer: z.uuid(),
  members: z.array(z.uuid()).min(1).max(100),
});
export const sessionSchema = z
  .object({
    groupId: z.uuid(),
    title: z.string().trim().min(1).max(160),
    venue: z.string().trim().min(1).max(200),
    startsAt: z.iso.datetime(),
    commitDeadline: z.iso.datetime(),
  })
  .refine((v) => new Date(v.commitDeadline) <= new Date(v.startsAt), {
    message: "Hạn chốt không được sau giờ bắt đầu",
  });
