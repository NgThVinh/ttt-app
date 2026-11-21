import { it, expect } from "vitest";
import { moneySchema } from "./schemas";
it("rejects floating point, exponent notation and bigint overflow", () => {
  for (const value of ["1.5", "1e6", "NaN", "9223372036854775808"])
    expect(moneySchema.safeParse(value).success).toBe(false);
  expect(moneySchema.parse("9007199254740993")).toBe("9007199254740993");
});
