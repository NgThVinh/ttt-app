"use server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { isReceiptImage, RECEIPT_MAX_BYTES } from "@/lib/receipt-image";
import type { FormResult } from "@/components/action-form";
const buckets = z.enum(["3t-payment-evidence", "3t-expense-receipts"]);
async function identity() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  return db;
}
export async function prepareReceipt(bucket: unknown, target: unknown) {
  const db = await identity();
  const input = z
    .object({ bucket: buckets, target: z.uuid() })
    .safeParse({ bucket, target });
  if (!input.success) return { error: "Thông tin ảnh không hợp lệ." };
  const payment = input.data.bucket === "3t-payment-evidence";
  const { data, error } = payment
    ? await db.rpc("add_payment_evidence", {
        target: input.data.target,
        kind_text: "screenshot",
      })
    : await db.rpc("reserve_expense_receipt", { target: input.data.target });
  if (error)
    return {
      error: "Không thể thêm ảnh. Kiểm tra quyền, hạn lưu và số ảnh hiện có.",
    };
  const row = await db
    .from(payment ? "payment_evidence" : "expense_receipts")
    .select("id,storage_path")
    .eq("id", data)
    .single();
  if (row.error) return { error: "Chưa tạo được phiên tải ảnh." };
  return { id: row.data.id as string, path: row.data.storage_path as string };
}
export async function finalizeReceipt(bucket: unknown, id: unknown) {
  const db = await identity();
  const input = z
    .object({ bucket: buckets, id: z.uuid() })
    .safeParse({ bucket, id });
  if (!input.success) return { error: "Phiên tải không hợp lệ." };
  const p = input.data;
  const row = await db
    .from(
      p.bucket === "3t-payment-evidence"
        ? "payment_evidence"
        : "expense_receipts",
    )
    .select("storage_path,status")
    .eq("id", p.id)
    .single();
  if (row.error || row.data.status !== "reserved")
    return { error: "Phiên tải ảnh đã đổi." };
  const object = await db.storage
    .from(p.bucket)
    .download(row.data.storage_path);
  if (object.error || !object.data) return { error: "Ảnh chưa được tải xong." };
  const bytes = new Uint8Array(await object.data.arrayBuffer());
  if (bytes.length > RECEIPT_MAX_BYTES || !isReceiptImage(bytes))
    return { error: "Chỉ nhận ảnh JPEG, PNG hoặc WebP tối đa 2 MiB." };
  const { error } = await db.rpc("finalize_receipt", {
    bucket: p.bucket,
    target: p.id,
  });
  return error
    ? { error: "Chưa lưu được ảnh; quyền hoặc hạn tải có thể đã thay đổi." }
    : { ok: true };
}
export async function listReceipts(bucket: unknown, target: unknown) {
  const db = await identity();
  const input = z
    .object({ bucket: buckets, target: z.uuid() })
    .safeParse({ bucket, target });
  if (!input.success) return { error: "Thông tin không hợp lệ.", rows: [] };
  const payment = input.data.bucket === "3t-payment-evidence";
  const { data, error } = await db
    .from(payment ? "payment_evidence" : "expense_receipts")
    .select(
      payment
        ? "id,kind,status,bank_txn_ref,note,transferred_at,created_at"
        : "id,status,created_at",
    )
    .eq(payment ? "settlement_id" : "expense_id", input.data.target)
    .neq("status", "reserved")
    .order("created_at");
  if (error) return { error: "Chưa tải được bằng chứng.", rows: [] };
  return {
    rows: data as unknown as {
      id: string;
      kind?: string;
      status: string;
      bank_txn_ref?: string;
      note?: string;
      transferred_at?: string;
      created_at: string;
    }[],
  };
}
export async function receiptLink(bucket: unknown, id: unknown) {
  const db = await identity();
  const input = z
    .object({ bucket: buckets, id: z.uuid() })
    .safeParse({ bucket, id });
  if (!input.success) return { error: "Ảnh không hợp lệ." };
  const row = await db
    .from(
      input.data.bucket === "3t-payment-evidence"
        ? "payment_evidence"
        : "expense_receipts",
    )
    .select("storage_path,status")
    .eq("id", input.data.id)
    .single();
  if (row.error || row.data.status !== "ready" || !row.data.storage_path)
    return { error: "Ảnh đã hết hạn hoặc bạn không có quyền xem." };
  const { data, error } = await db.storage
    .from(input.data.bucket)
    .createSignedUrl(row.data.storage_path, 60);
  return error
    ? { error: "Không lấy được ảnh hoặc ảnh đã hết hạn." }
    : { url: data.signedUrl };
}
export async function addEvidenceNote(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const input = z
    .object({
      target: z.uuid(),
      kind: z.enum(["bank_txn_ref", "note"]),
      content: z.string().trim().min(1).max(1000),
      time: z.string().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Kiểm tra nội dung bằng chứng." };
  const p = input.data;
  let time: string | null = null;
  if (p.time) {
    const date = new Date(p.time + ":00+07:00");
    if (!Number.isFinite(date.getTime()))
      return { message: "Giờ chuyển không hợp lệ." };
    time = date.toISOString();
  }
  const { error } = await db.rpc("add_payment_evidence", {
    target: p.target,
    kind_text: p.kind,
    reference_text: p.kind === "bank_txn_ref" ? p.content : null,
    note_text: p.kind === "note" ? p.content : null,
    transfer_time: time,
  });
  return error
    ? {
        message:
          "Chưa lưu được. Mã giao dịch tối đa 120 ký tự; kiểm tra người chuyển và hạn bổ sung.",
      }
    : {
        ok: true,
        message:
          "Đã lưu bằng chứng. Người nhận vẫn cần kiểm tra sao kê và xác nhận.",
      };
}
