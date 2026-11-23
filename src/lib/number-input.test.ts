import { expect, it } from "vitest";
import { splitExpense } from "./expense-calculation";
import {
  courtInputSchema,
  formatVndInput,
  vndInputSchema,
  weightInputSchema,
} from "./number-input";

it.each(["400000", "400.000", "400,000", "  400000  ", "\u00a0400.000\u00a0"])(
  "normalizes VND form input %s without changing its amount",
  (input) => expect(courtInputSchema.parse(input)).toBe("400000"),
);

it.each([
  "400000.5",
  "400000,5",
  "1.00",
  "1,00",
  "1.000,000",
  "1,000.000",
  "40 000",
  "1e6",
  "400k",
  "",
  "abc",
])(
  "rejects ambiguous/decimal VND input %s rather than multiplying it",
  (input) => expect(vndInputSchema.safeParse(input).success).toBe(false),
);

it("preserves zero, signed discounts and the existing amount boundary", () => {
  expect(courtInputSchema.parse("0")).toBe("0");
  expect(courtInputSchema.safeParse("-5.000").success).toBe(false);
  expect(vndInputSchema.parse("-5.000")).toBe("-5000");
  expect(vndInputSchema.parse("1.000.000.000.000")).toBe("1000000000000");
  expect(vndInputSchema.safeParse("1.000.000.000.001").success).toBe(false);
  expect(vndInputSchema.safeParse("-1.000.000.000.001").success).toBe(false);
  expect(vndInputSchema.safeParse("9".repeat(100)).success).toBe(false);
  expect(formatVndInput(" 400,000 ")).toBe("400.000");
  expect(formatVndInput("400000.5")).toBe("400000.5");
});

it("treats comma as a decimal separator for weights, keeping rational precision", () => {
  expect(weightInputSchema.parse(" 0,5 ")).toBe("0.5");
  expect(weightInputSchema.parse("0,123456")).toBe("0.123456");
  for (const input of ["", "0", "-1", "100,000001", "0,1234567", "1,000.000"])
    expect(weightInputSchema.safeParse(input).success).toBe(false);
  const shares = (weight: string) =>
    splitExpense(
      BigInt(courtInputSchema.parse("90.000")),
      "total",
      "weighted",
      [
        { id: "a", value: "1" },
        { id: "b", value: weightInputSchema.parse(weight) },
      ],
      "a",
    );
  expect(shares("0,5")).toEqual(shares("0.5"));
});
