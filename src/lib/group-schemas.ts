import { z } from "zod";
export const groupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sport: z.string().trim().min(1).max(60),
});
export const inviteSchema = z.object({
  groupId: z.uuid(),
  days: z.coerce.number().int().min(1).max(30),
  uses: z.coerce.number().int().min(1).max(100),
});
export const bankSchema = z
  .object({
    display_name: z.string().trim().min(1).max(100),
    bank_bin: z
      .string()
      .regex(/^\d{6}$/)
      .or(z.literal("")),
    bank_account_no: z
      .string()
      .regex(/^[A-Za-z0-9]{4,30}$/)
      .or(z.literal("")),
    bank_account_name: z.string().trim().max(100),
  })
  .refine(
    (v) =>
      (!v.bank_bin && !v.bank_account_no && !v.bank_account_name) ||
      (!!v.bank_bin && !!v.bank_account_no && !!v.bank_account_name),
    { message: "Điền đủ ngân hàng, số tài khoản và tên chủ tài khoản" },
  );
