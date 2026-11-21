import { describe, it, expect } from "vitest";
import { allocate, reconcile } from "./money";
describe("money conservation", () => {
  it.each([
    0n,
    1n,
    999n,
    1000n,
    1250n,
    400000n,
    -1250n,
    -400000n,
    9007199254740993n,
  ])("allocates %s exactly", (amount) => {
    const split = [
      { memberId: "a", weight: 1n },
      { memberId: "b", weight: 2n },
      { memberId: "c", weight: 1n },
    ];
    expect(
      allocate(amount, split, "b").reduce((a, s) => a + s.amount, 0n),
    ).toBe(amount);
    expect(allocate(-amount, split, "b").map((s) => s.amount)).toEqual(
      allocate(amount, split, "b").map((s) => -s.amount),
    );
  });
  it("assigns the sub-thousand remainder to payer", () =>
    expect(
      allocate(
        1250n,
        [
          { memberId: "a", weight: 1n },
          { memberId: "b", weight: 1n },
        ],
        "b",
      ),
    ).toEqual([
      { memberId: "a", amount: 1000n },
      { memberId: "b", amount: 250n },
    ]));
  it("accounts for confirmed transfers after collector change", () =>
    expect(
      reconcile(
        { a: -100n, b: 200n, c: -100n },
        [{ from: "c", to: "a", amount: 100n }],
        "b",
      ),
    ).toEqual([{ from: "a", to: "b", amount: 200n }]));
  it("issues refunds after removal", () =>
    expect(
      reconcile(
        { a: 100n, b: -100n, c: 0n },
        [
          { from: "b", to: "a", amount: 100n },
          { from: "c", to: "a", amount: 100n },
        ],
        "a",
      ),
    ).toEqual([{ from: "a", to: "c", amount: 100n }]));
});
