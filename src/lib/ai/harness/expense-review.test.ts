import { it, expect } from "vitest";
import { detailSchema } from "@/lib/session-data";
import { expenseReview } from "./expense-review";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222",
  court = "33333333-3333-4333-8333-333333333333";
function session() {
  return detailSchema.parse({
    id: a,
    group_id: a,
    title: "Court",
    venue: "Court",
    starts_at: "2026-11-20T12:00:00Z",
    commit_deadline: "2026-11-20T12:00:00Z",
    status: "played",
    revision: "3",
    deadline_passed: true,
    collector_member_id: a,
    my_member_id: a,
    attendees: [a, b].map((id) => ({
      member_id: id,
      name: id === a ? "An" : "Bình",
      rsvp: "going",
      weight: "1",
      committed_at: "2026-11-20T12:00:00Z",
      removed_at: null,
    })),
    expenses: [
      {
        id: court,
        title: "Court",
        amount: "100000",
        paid_by: a,
        split_mode: "weighted",
        allocations: [a, b].map((member_id) => ({
          member_id,
          amount: "50000",
        })),
      },
    ],
    settlements: [
      {
        id: b,
        from_member: b,
        to_member: a,
        from_name: "Bình",
        to_name: "An",
        amount: "50000",
        ref_code: "ABC234",
        status: "confirmed",
        kind: "original",
        bank_bin: null,
        bank_account_no: null,
        bank_account_name: null,
      },
    ],
    history: [],
  });
}
const body = {
  expense_id: "",
  category_id: "",
  note_text: "",
  title_text: "Discount",
  raw_amount: "-20000",
  payer: a,
  beneficiaries: [b],
  mode: "total",
  split: "equal",
  values_text: [],
  reason: "Discount",
};
it("previews a refund against confirmed cash instead of asking for the debt again", () => {
  const review = expenseReview(session(), body, court);
  expect(review.rows.find((r) => r.id === b)).toEqual({
    id: b,
    before: "50000",
    after: "30000",
    delta: "-20000",
  });
  expect(review.transfers).toEqual([{ from: a, to: b, amount: "20000" }]);
});
it("court edits follow the collector and all attendees, matching server coercion", () => {
  const review = expenseReview(
    session(),
    {
      ...body,
      expense_id: court,
      raw_amount: "60000",
      payer: b,
      beneficiaries: [a],
      mode: "per_person",
      split: "equal",
    },
    court,
  );
  expect(review.rows.map((r) => r.after)).toEqual(["30000", "30000"]);
  expect(review.transfers).toEqual([{ from: a, to: b, amount: "20000" }]);
});
