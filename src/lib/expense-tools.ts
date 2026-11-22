import { z } from "zod";
import { moneySchema } from "./schemas";
export const expenseToolsSchema = z.object({
  categories: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      icon: z.string(),
      active: z.boolean(),
      sort_order: z.number(),
    }),
  ),
  templates: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      category_id: z.uuid().nullable(),
      amount: moneySchema,
      mode: z.enum(["total", "per_person"]),
      split: z.enum(["equal", "weighted"]),
      active: z.boolean(),
    }),
  ),
});
export type ExpenseTools = z.infer<typeof expenseToolsSchema>;
export const expenseEditorSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  kind: z.enum(["court", "extra"]),
  status: z.enum(["active", "proposed"]),
  amount: moneySchema,
  payer: z.uuid().nullable(),
  mode: z.enum(["total", "per_person"]),
  split: z.enum(["equal", "weighted", "exact", "percent"]),
  note: z.string(),
  category_id: z.uuid().nullable(),
  beneficiaries: z.array(z.uuid()),
  values: z.array(z.string()),
  can_edit: z.boolean(),
});
export type ExpenseEditor = z.infer<typeof expenseEditorSchema>;
