import { allocate, type Share } from "./money";
export function decimalWeight(value: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error("Hệ số không hợp lệ");
  const [whole, part = ""] = value.split(".");
  return BigInt(whole) * 1000000n + BigInt(part.padEnd(6, "0"));
}
export function splitExpense(
  raw: bigint,
  mode: "total" | "per_person",
  split: "equal" | "weighted" | "exact" | "percent",
  members: { id: string; value: string }[],
  payer: string,
): { amount: bigint; shares: Share[] } {
  const amount = mode === "per_person" ? raw * BigInt(members.length) : raw;
  let weights = members.map((m) => ({
    memberId: m.id,
    weight: split === "equal" ? 1000000n : decimalWeight(m.value),
  }));
  const sum = weights.reduce((n, m) => n + m.weight, 0n);
  if (
    (split === "percent" && sum !== 100000000n) ||
    (split === "exact" && sum !== (amount < 0n ? -amount : amount) * 1000000n)
  )
    throw new Error("Tổng phần chia không khớp");
  if (sum === 0n) weights = weights.map((m) => ({ ...m, weight: 1n }));
  return { amount, shares: allocate(amount, weights, payer) };
}
export function balances(
  expenses: { amount: bigint; payer: string; shares: Share[] }[],
): Record<string, bigint> {
  const net: Record<string, bigint> = {};
  for (const e of expenses) {
    if (e.shares.reduce((n, s) => n + s.amount, 0n) !== e.amount)
      throw new Error("Bảng chia không khớp");
    net[e.payer] = (net[e.payer] || 0n) + e.amount;
    for (const s of e.shares)
      net[s.memberId] = (net[s.memberId] || 0n) - s.amount;
  }
  return net;
}
