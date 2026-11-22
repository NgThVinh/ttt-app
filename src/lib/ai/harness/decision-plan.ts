import { z } from "zod";
import { formatMoney } from "@/lib/money";
import type { Family } from "./tool-palette";
export function decisionPlan(
  result: { intent: string; confidence: number } | null,
): {
  direct: "debts" | "privileged" | "mark_paid" | "confirm_received" | null;
  families?: Family[];
} {
  if (!result || result.confidence < 0.9) return { direct: null };
  const families: Record<string, Family[]> = {
    mark_paid: ["debts"],
    confirm_received: ["debts"],
    expense: ["expenses"],
    schedule: ["sessions", "create"],
    poll: ["polls"],
    rsvp: ["sessions"],
  };
  return {
    direct:
      result.intent === "debts"
        ? "debts"
        : result.intent === "mark_paid" || result.intent === "confirm_received"
          ? result.intent
          : result.intent === "privileged"
            ? "privileged"
            : null,
    families: families[result.intent],
  };
}
const debtResult = z.object({
  total: z.string().regex(/^\d+$/),
  rows: z.array(
    z.object({
      amount: z.string().regex(/^\d+$/),
      from_name: z.string(),
      to_name: z.string(),
      href: z.string().regex(/^\/sessions\/[a-f0-9-]{36}$/),
    }),
  ),
});
export function debtReply(owe: unknown, owed: unknown) {
  const send = debtResult.parse(owe),
    receive = debtResult.parse(owed);
  const rows = [
    ...send.rows
      .slice(0, 10)
      .map(
        (r) => `Bạn cần trả ${r.to_name}: ${formatMoney(r.amount)} · ${r.href}`,
      ),
    ...receive.rows
      .slice(0, 10)
      .map(
        (r) =>
          `${r.from_name} cần trả bạn: ${formatMoney(r.amount)} · ${r.href}`,
      ),
  ];
  return [
    `Trong nhóm đang chọn:`,
    `Bạn cần trả: ${formatMoney(send.total)}.`,
    `Bạn cần thu: ${formatMoney(receive.total)}.`,
    ...rows,
    "Xem đầy đủ: /debts",
  ].join("\n");
}
export function decisionUsage(value: unknown) {
  const result = z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .safeParse(value);
  return result.success
    ? result.data.input_tokens + result.data.output_tokens
    : 1000;
}
