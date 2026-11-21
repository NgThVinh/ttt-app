export type Share = { memberId: string; amount: bigint };
export type Split = { memberId: string; weight: bigint };
/** Hamilton allocation in 1,000 VND units; symmetric for discounts. */
export function allocate(
  amount: bigint,
  splits: Split[],
  payer?: string,
): Share[] {
  if (
    !splits.length ||
    new Set(splits.map((s) => s.memberId)).size !== splits.length ||
    splits.some((s) => s.weight <= 0n)
  )
    throw new Error("Danh sách chia không hợp lệ");
  const sign = amount < 0n ? -1n : 1n,
    absolute = amount * sign;
  const units = absolute / 1000n,
    tail = absolute % 1000n;
  const weight = splits.reduce((a, s) => a + s.weight, 0n);
  const rows = splits.map((s) => ({
    ...s,
    units: (units * s.weight) / weight,
    remainder: (units * s.weight) % weight,
  }));
  let left = units - rows.reduce((a, s) => a + s.units, 0n);
  const ranked = [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? a.memberId.localeCompare(b.memberId)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const row of ranked) {
    if (left-- > 0n) row.units++;
  }
  const recipient =
    rows.find((s) => s.memberId === payer) ??
    [...rows].sort((a, b) =>
      a.weight === b.weight
        ? a.memberId.localeCompare(b.memberId)
        : a.weight > b.weight
          ? -1
          : 1,
    )[0];
  return rows.map((s) => ({
    memberId: s.memberId,
    amount: sign * (s.units * 1000n + (s === recipient ? tail : 0n)),
  }));
}
export type Transfer = { from: string; to: string; amount: bigint };
export function reconcile(
  net: Record<string, bigint>,
  confirmed: Transfer[],
  collector: string,
): Transfer[] {
  const residual = { ...net };
  for (const t of confirmed) {
    residual[t.from] = (residual[t.from] ?? 0n) + t.amount;
    residual[t.to] = (residual[t.to] ?? 0n) - t.amount;
  }
  if (Object.values(residual).reduce((a, b) => a + b, 0n) !== 0n)
    throw new Error("Tổng số dư không bằng 0");
  return Object.entries(residual)
    .filter(([id, n]) => id !== collector && n !== 0n)
    .map(([id, n]) =>
      n < 0n
        ? { from: id, to: collector, amount: -n }
        : { from: collector, to: id, amount: n },
    );
}
export const formatMoney = (value: bigint | string) =>
  new Intl.NumberFormat("vi-VN").format(BigInt(value)) + "đ";
