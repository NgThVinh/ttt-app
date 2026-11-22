import { z } from "zod";
const negativeAmount =
  /-\s*\d+tr\d{1,3}(?![a-z0-9])|-\s*\d+(?:[.,]\d+)?\s*(?:trieu|tr|nghin|ngan|k|vnd|dong|d)(?![a-z0-9])/;
function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}
export function explicitAmounts(message: string) {
  const text = normalize(message),
    found = new Set<string>(),
    ranges: { start: number; end: number }[] = [];
  if (negativeAmount.test(text)) return [];
  const add = (amount: bigint, start: number, end: number) => {
    if (amount > 0n && amount <= 1000000000000n) found.add(amount.toString());
    ranges.push({ start, end });
  };
  for (const m of text.matchAll(/\b(\d+)tr(\d{1,3})(?![a-z0-9])/g))
    add(
      BigInt(m[1]) * 1000000n + BigInt(m[2].padEnd(3, "0")) * 1000n,
      m.index,
      m.index + m[0].length,
    );
  for (const m of text.matchAll(
    /\b(\d{1,3}(?:[.,]\d{3})+)\s*(?:vnd|dong|d)(?![a-z0-9])/g,
  ))
    add(BigInt(m[1].replace(/[.,]/g, "")), m.index, m.index + m[0].length);
  for (const m of text.matchAll(
    /\b(\d+)(?:[.,](\d{1,6}))?\s*(trieu|tr|nghin|ngan|k|vnd|dong|d)(?![a-z0-9])/g,
  )) {
    if (ranges.some((r) => m.index >= r.start && m.index < r.end)) continue;
    const scale = ["trieu", "tr"].includes(m[3])
      ? 1000000n
      : ["nghin", "ngan", "k"].includes(m[3])
        ? 1000n
        : 1n;
    const fraction = BigInt((m[2] || "").padEnd(6, "0")) * scale;
    if (fraction % 1000000n !== 0n) continue;
    add(
      BigInt(m[1]) * scale + fraction / 1000000n,
      m.index,
      m.index + m[0].length,
    );
  }
  return [...found];
}
const rowsSchema = z.array(
  z.object({
    id: z.uuid(),
    amount: z.string().regex(/^\d+$/),
    status: z.string(),
    from_name: z.string(),
    to_name: z.string(),
    ref_code: z.string().optional(),
  }),
);
export function paymentReference(
  message: string,
  rows: unknown,
  operation: "mark_paid" | "confirm_received",
) {
  const parsed = rowsSchema.parse(rows),
    amounts = explicitAmounts(message);
  const normalized = normalize(message);
  // Routing confidence is not evidence that money moved. Ambiguous, future,
  // conditional, quoted or negated messages must be reviewed in the app instead.
  if (
    negativeAmount.test(normalized) ||
    /\b(chua|khong|dung|se|sap|neu|gia su|du dinh|co le|hinh nhu|bao rang|noi rang|vi du|thu nghiem)\b/.test(
      normalized,
    ) ||
    /[?"“”«»]/.test(message)
  )
    return null;
  if (amounts.length > 1) return null;
  const ref = normalize(message).match(/\b3t-([a-z0-9]{6})\b/)?.[1];
  if (!ref && amounts.length !== 1) return null;
  const text =
    " " +
    normalize(message)
      .replace(/[^a-z0-9]+/g, " ")
      .trim() +
    " ";
  const matches = parsed.filter((row) => {
    if (
      ![
        "pending",
        ...(operation === "confirm_received" ? ["marked_paid"] : []),
      ].includes(row.status)
    )
      return false;
    if (amounts.length && row.amount !== amounts[0]) return false;
    if (ref) return row.ref_code?.toLowerCase() === ref;
    const name = normalize(
      operation === "mark_paid" ? row.to_name : row.from_name,
    )
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return !!name && text.includes(" " + name + " ");
  });
  return matches.length === 1 ? matches[0] : null;
}
