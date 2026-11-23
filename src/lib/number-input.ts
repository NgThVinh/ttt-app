import { z } from "zod";

// Form input only. Service/RPC payloads continue to use integer strings.
export const vndInputSchema = z
  .string()
  .trim()
  .max(80, "Số tiền quá dài.")
  .transform((text, ctx) => {
    if (
      !/^-?\d+$/.test(text) &&
      !/^-?\d{1,3}(?:\.\d{3})+$/.test(text) &&
      !/^-?\d{1,3}(?:,\d{3})+$/.test(text)
    ) {
      ctx.issues.push({
        code: "custom",
        message:
          "Nhập số tiền nguyên, ví dụ 400000 hoặc 400.000 (không có phần lẻ).",
        input: text,
      });
      return z.NEVER;
    }
    return BigInt(text.replace(/[.,]/g, "")).toString();
  })
  .refine(
    (value) =>
      BigInt(value) >= -1000000000000n && BigInt(value) <= 1000000000000n,
    "Số tiền không được vượt quá 1.000.000.000.000đ.",
  );

export const courtInputSchema = vndInputSchema.refine(
  (value) => BigInt(value) >= 0n,
  "Tiền sân không được âm. Giảm giá được nhập ở phần phụ phí.",
);

export const weightInputSchema = z
  .string()
  .trim()
  .max(20)
  .regex(
    /^\d+(?:[.,]\d{1,6})?$/,
    "Nhập hệ số, ví dụ 1 hoặc 0,5 (tối đa 6 số lẻ).",
  )
  .transform((value) => value.replace(",", "."))
  .refine(
    (value) => Number(value) > 0 && Number(value) <= 100,
    "Hệ số cần lớn hơn 0 và không quá 100.",
  );

export function formatVndInput(value: string): string {
  const parsed = vndInputSchema.safeParse(value);
  return parsed.success ? BigInt(parsed.data).toLocaleString("vi-VN") : value;
}
