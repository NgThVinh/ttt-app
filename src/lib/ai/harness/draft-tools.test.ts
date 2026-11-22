import { it, expect } from "vitest";
import { aiExpenseInputSchema, draftTools } from "./draft-tools";
import type { supabase } from "@/lib/supabase";
const session = "11111111-1111-4111-8111-111111111111",
  member = "55555555-5555-4555-8555-555555555555";
const input = {
  session_id: session,
  revision: "3",
  title: "Nước",
  amount: "50000",
  payer: member,
  beneficiaries: [member],
  mode: "total" as const,
  split: "equal" as const,
  values: [],
  reason: "Mua nước",
  expense_id: "",
  category_id: "",
  note: "",
};
it("requires an explicit session reference and unique beneficiaries", () => {
  expect(aiExpenseInputSchema.parse(input).session_id).toBe(session);
  expect(
    aiExpenseInputSchema.safeParse({
      ...input,
      session_id: undefined,
      sid: session,
    }).success,
  ).toBe(false);
  expect(
    aiExpenseInputSchema.safeParse({
      ...input,
      beneficiaries: [member, member],
    }).success,
  ).toBe(false);
});
it("maps the model session reference to the existing app financial schema", async () => {
  let called: unknown;
  const db = {
    rpc: async (name: string, args: unknown) => {
      called = { name, args };
      return { data: { id: session, tier: "T2" }, error: null };
    },
  } as unknown as Awaited<ReturnType<typeof supabase>>;
  await draftTools(db, member).draft_expense.execute!(input, {
    toolCallId: "test",
    messages: [],
    context: {},
  });
  expect(called).toMatchObject({
    name: "create_ai_draft",
    args: {
      command: "expense",
      body: {
        sid: session,
        expected_revision: "3",
        raw_amount: "50000",
        payer: member,
        beneficiaries: [member],
      },
    },
  });
});
