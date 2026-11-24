import { z } from "zod";
import { expenseDraftSchema } from "./session-data";
import { vndInputSchema } from "./number-input";
export const finishExtrasSchema = z
  .array(expenseDraftSchema.extend({ amount: vndInputSchema }))
  .max(199);
export function expenseCommand(e: z.infer<typeof expenseDraftSchema>) {
  return {
    expense_id: "",
    category_id: e.category_id,
    note_text: e.note,
    title_text: e.title,
    raw_amount: e.amount,
    payer: e.payer,
    beneficiaries: e.beneficiaries,
    mode: e.mode,
    split: e.split,
    values_text: e.values,
    reason: e.reason,
  };
}
