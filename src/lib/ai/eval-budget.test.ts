import { expect, it } from "vitest";
import { evalBudget, canRunEval } from "./eval-budget";
it("leaves a request margin and rejects invalid or unlimited budgets", () => {
  expect(evalBudget()).toBe(15000);
  expect(canRunEval([3538, 4531], 15000)).toBe(true);
  expect(canRunEval([3538, 4531, 4597], 15000)).toBe(false);
  for (const value of ["", "0", "Infinity", "-1", "200001", "6000.5"])
    expect(() => evalBudget(value)).toThrow();
});
