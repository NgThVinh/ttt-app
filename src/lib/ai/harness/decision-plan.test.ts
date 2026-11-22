import { it, expect } from "vitest";
import { decisionPlan, debtReply, decisionUsage } from "./decision-plan";
it("uses decisions only for routing and never produces an executable write", () => {
  expect(decisionPlan({ intent: "mark_paid", confidence: 0.99 })).toEqual({
    direct: "mark_paid",
    families: ["debts"],
  });
  expect(decisionPlan({ intent: "expense", confidence: 0.99 })).toEqual({
    direct: null,
    families: ["expenses"],
  });
  expect(decisionPlan({ intent: "privileged", confidence: 0.99 }).direct).toBe(
    "privileged",
  );
  expect(decisionPlan({ intent: "debts", confidence: 0.5 })).toEqual({
    direct: null,
  });
  expect(decisionPlan(null)).toEqual({ direct: null });
});
it("formats debt amounts from validated server data without asking a model to calculate", () => {
  const reply = debtReply(
    {
      total: "85000",
      rows: [
        {
          amount: "85000",
          from_name: "Bình",
          to_name: "An",
          href: "/sessions/11111111-1111-4111-8111-111111111111",
        },
      ],
    },
    { total: "0", rows: [] },
  );
  expect(reply).toContain("85.000đ");
  expect(reply).toContain("Bạn cần trả An");
  expect(() =>
    debtReply({ total: "bad", rows: [] }, { total: "0", rows: [] }),
  ).toThrow();
  expect(decisionUsage({ input_tokens: 268, output_tokens: 1 })).toBe(269);
});
