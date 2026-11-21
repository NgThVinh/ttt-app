import { it, expect } from "vitest";
import { splitExpense, balances } from "./expense-calculation";
import { reconcile } from "./money";
it("handles exact zero shares and percentages with decimals", () => {
  expect(
    splitExpense(
      10000n,
      "total",
      "exact",
      [
        { id: "a", value: "0" },
        { id: "b", value: "10000" },
      ],
      "a",
    ).shares.map((s) => s.amount),
  ).toEqual([0n, 10000n]);
  expect(
    splitExpense(
      10000n,
      "total",
      "percent",
      [
        { id: "a", value: "12.5" },
        { id: "b", value: "87.5" },
      ],
      "a",
    ).shares.reduce((n, s) => n + s.amount, 0n),
  ).toBe(10000n);
});
it("supports per-person discounts and gives a non-collector advance back", () => {
  const discount = splitExpense(
    -5000n,
    "per_person",
    "equal",
    [
      { id: "a", value: "1" },
      { id: "b", value: "1" },
    ],
    "a",
  );
  expect(discount.amount).toBe(-10000n);
  const net = balances([
    {
      amount: 10000n,
      payer: "b",
      shares: [
        { memberId: "a", amount: 5000n },
        { memberId: "b", amount: 5000n },
      ],
    },
  ]);
  expect(reconcile(net, [], "a")).toEqual([
    { from: "a", to: "b", amount: 5000n },
  ]);
});
it("rejects invalid exact/percent totals and preserves zero totals", () => {
  expect(() =>
    splitExpense(10000n, "total", "percent", [{ id: "a", value: "90" }], "a"),
  ).toThrow();
  expect(
    splitExpense(0n, "total", "exact", [{ id: "a", value: "0" }], "a").shares[0]
      .amount,
  ).toBe(0n);
});
