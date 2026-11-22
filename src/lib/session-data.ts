import { z } from "zod";
import { moneySchema } from "./schemas";
export const detailSchema = z.object({
  id: z.uuid(),
  group_id: z.uuid(),
  title: z.string(),
  venue: z.string(),
  starts_at: z.string(),
  commit_deadline: z.string(),
  status: z.enum(["planned", "played", "settled", "cancelled"]),
  revision: z.string(),
  deadline_passed: z.boolean(),
  calendar_locked: z.boolean().default(false),
  collector_member_id: z.uuid().nullable(),
  my_member_id: z.uuid(),
  attendees: z.array(
    z.object({
      member_id: z.uuid(),
      name: z.string(),
      rsvp: z.string(),
      weight: z.string(),
      committed_at: z.string().nullable(),
      removed_at: z.string().nullable(),
    }),
  ),
  expenses: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      amount: moneySchema,
      paid_by: z.uuid().nullable(),
      split_mode: z.string(),
      category_name: z.string().nullable().optional(),
      category_id: z.uuid().nullable().optional(),
      note: z.string().nullable().optional(),
      paid_by_name: z.string().nullable().optional(),
      created_by_name: z.string().nullable().optional(),
      allocations: z.array(
        z.object({ member_id: z.uuid(), amount: moneySchema }),
      ),
    }),
  ),
  settlements: z.array(
    z.object({
      id: z.uuid(),
      from_member: z.uuid(),
      to_member: z.uuid(),
      from_name: z.string(),
      to_name: z.string(),
      amount: moneySchema,
      ref_code: z.string(),
      status: z.string(),
      kind: z.string(),
      bank_bin: z.string().nullable(),
      bank_account_no: z.string().nullable(),
      bank_account_name: z.string().nullable(),
    }),
  ),
  history: z.array(
    z.object({
      action: z.string(),
      created_at: z.string(),
      reason: z.string().nullable(),
      actor_name: z.string().optional(),
    }),
  ),
});
export type SessionDetail = z.infer<typeof detailSchema>;
export const expenseInputSchema = z
  .object({
    sid: z.uuid(),
    revision: z.string().regex(/^\d+$/),
    title: z.string().trim().min(1).max(160),
    amount: moneySchema,
    mode: z.enum(["total", "per_person"]),
    split: z.enum(["equal", "weighted", "exact", "percent"]),
    payer: z.uuid(),
    beneficiaries: z.array(z.uuid()).min(1).max(100),
    values: z.array(z.string().regex(/^\d+(\.\d{1,6})?$/)).max(100),
    reason: z.string().trim().min(1).max(500),
    expense_id: z.uuid().or(z.literal("")).default(""),
    category_id: z.uuid().or(z.literal("")).default(""),
    note: z.string().trim().max(2000).default(""),
  })
  .refine((v) => new Set(v.beneficiaries).size === v.beneficiaries.length);
