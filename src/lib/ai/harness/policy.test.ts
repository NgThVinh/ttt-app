import { it, expect } from "vitest";
import { classifyTool, confirmationRoute } from "./policy";
const facts = {
  collector: false,
  hasPayments: false,
  affectsOthers: true,
  selfOnly: false,
};
it("blocks unknown and privileged operations independently of prompt", () => {
  for (const operation of [
    "delete_member",
    "set_bank",
    "configure_ai",
    "approve",
    "execute_sql",
    "delete_log",
    "set_role",
  ])
    expect(
      classifyTool(operation, { ...facts, collector: true, selfOnly: true }),
    ).toBe("T4");
  expect(confirmationRoute("T4")).toBe("app-link");
});
it("requires self-only facts for T1 and app approval for collected money", () => {
  expect(classifyTool("draft_rsvp", facts)).toBe("T4");
  expect(classifyTool("draft_rsvp", { ...facts, selfOnly: true })).toBe("T1");
  expect(classifyTool("draft_expense", facts)).toBe("T4");
  expect(classifyTool("draft_expense", { ...facts, collector: true })).toBe(
    "T2",
  );
  expect(
    classifyTool("draft_expense", {
      ...facts,
      collector: true,
      hasPayments: true,
    }),
  ).toBe("T3");
  expect(confirmationRoute("T3")).toBe("app-approval");
});
