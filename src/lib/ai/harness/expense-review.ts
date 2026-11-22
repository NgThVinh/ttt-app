import { expenseDraftSchema, type SessionDetail } from "@/lib/session-data";
import { splitExpense, balances } from "@/lib/expense-calculation";
import { reconcile } from "@/lib/money";
export function expenseReview(
  s: SessionDetail,
  body: Record<string, unknown>,
  courtExpenseId: string | null,
) {
  const e = expenseDraftSchema.parse({
    title: body.title_text,
    amount: body.raw_amount,
    payer: body.payer,
    beneficiaries: body.beneficiaries,
    mode: body.mode,
    split: body.split,
    values: body.values_text,
    reason: body.reason,
    expense_id: body.expense_id,
    category_id: body.category_id,
    note: body.note_text,
  });
  const court = !!courtExpenseId && e.expense_id === courtExpenseId;
  const people = s.attendees.filter((a) => a.rsvp === "going" && !a.removed_at);
  const beneficiaries = court
    ? people.map((a) => a.member_id)
    : e.beneficiaries;
  const payer = court ? s.collector_member_id : e.payer;
  if (!payer || !s.collector_member_id) throw Error("Missing collector");
  const split = court ? "weighted" : e.split;
  const changed = splitExpense(
    BigInt(e.amount),
    court ? "total" : e.mode,
    split,
    beneficiaries.map((id, index) => ({
      id,
      value:
        split === "weighted"
          ? people.find((a) => a.member_id === id)?.weight || "0"
          : e.values[index] || "0",
    })),
    payer,
  );
  const before = s.expenses.map((x) => ({
    id: x.id,
    amount: BigInt(x.amount),
    payer: x.paid_by!,
    shares: x.allocations.map((a) => ({
      memberId: a.member_id,
      amount: BigInt(a.amount),
    })),
  }));
  if (before.some((x) => !x.payer)) throw Error("Missing payer");
  const after = [
    ...before.filter((x) => x.id !== e.expense_id),
    { id: e.expense_id, amount: changed.amount, payer, shares: changed.shares },
  ];
  const ids = new Set(
    [...before, ...after].flatMap((x) => x.shares.map((a) => a.memberId)),
  );
  const rows = [...ids].map((id) => {
    const old = before.reduce(
      (n, x) => n + (x.shares.find((a) => a.memberId === id)?.amount || 0n),
      0n,
    );
    const next = after.reduce(
      (n, x) => n + (x.shares.find((a) => a.memberId === id)?.amount || 0n),
      0n,
    );
    return {
      id,
      before: old.toString(),
      after: next.toString(),
      delta: (next - old).toString(),
    };
  });
  const transfers = reconcile(
    balances(after),
    s.settlements
      .filter((p) => p.status === "confirmed")
      .map((p) => ({
        from: p.from_member,
        to: p.to_member,
        amount: BigInt(p.amount),
      })),
    s.collector_member_id,
  );
  return {
    rows,
    transfers: transfers.map((t) => ({ ...t, amount: t.amount.toString() })),
  };
}
