"use client";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  prepareReceipt,
  finalizeReceipt,
  listReceipts,
  receiptLink,
  addEvidenceNote,
} from "@/app/receipts/actions";
import { RECEIPT_MAX_BYTES } from "@/lib/receipt-image";
import ActionForm, { type FormResult } from "./action-form";
async function compress(file: File) {
  if (file.size > 20 * 1024 * 1024) throw Error("Ảnh gốc tối đa 20 MiB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Trình duyệt chưa hỗ trợ nén ảnh.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(Error("Không đọc được ảnh."))),
        "image/jpeg",
        0.8,
      ),
    );
    if (blob.size > RECEIPT_MAX_BYTES)
      throw Error("Ảnh sau nén vẫn quá 2 MiB. Hãy chọn ảnh nhỏ hơn.");
    return blob;
  } finally {
    bitmap.close();
  }
}
export default function ReceiptPanel({
  bucket,
  target,
  canUpload = false,
}: {
  bucket: "3t-payment-evidence" | "3t-expense-receipts";
  target: string;
  canUpload?: boolean;
}) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [rows, setRows] = useState<
      Awaited<ReturnType<typeof listReceipts>>["rows"]
    >([]),
    [opened, setOpened] = useState(false),
    [image, setImage] = useState("");
  async function refresh() {
    const result = await listReceipts(bucket, target);
    setRows(result.rows);
    setOpened(true);
    if (result.error) setMessage(result.error);
  }
  async function saveNote(state: FormResult, form: FormData) {
    const result = await addEvidenceNote(state, form);
    if (result.ok) await refresh();
    return result;
  }
  async function upload(file: File) {
    setBusy(true);
    setImage("");
    try {
      const blob = await compress(file);
      const prepared = await prepareReceipt(bucket, target);
      if (prepared.error || !prepared.path || !prepared.id)
        throw Error(prepared.error || "Không tạo được phiên tải.");
      const db = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      );
      const uploaded = await db.storage
        .from(bucket)
        .upload(prepared.path, blob, {
          contentType: "image/jpeg",
          upsert: false,
        });
      if (uploaded.error)
        throw Error(
          "Không tải được ảnh. Có thể mạng yếu, hết dung lượng hoặc quyền đã thay đổi. Bạn vẫn có thể ghi mã giao dịch.",
        );
      const completed = await finalizeReceipt(bucket, prepared.id);
      if (completed.error) throw Error(completed.error);
      setMessage(
        "Đã lưu ảnh riêng tư. Ảnh không thay thế xác nhận từ người nhận.",
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Chưa tải được ảnh.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ marginTop: 16 }}>
      <button type="button" className="secondary" onClick={refresh}>
        Xem{" "}
        {bucket === "3t-payment-evidence" ? "bằng chứng thanh toán" : "hóa đơn"}
      </button>
      {canUpload && (
        <>
          <label>
            Thêm ảnh
            <input
              aria-label="Chọn ảnh biên lai"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
            />
          </label>
          {bucket === "3t-payment-evidence" && (
            <ActionForm action={saveNote} label="Lưu mã giao dịch / ghi chú">
              <input type="hidden" name="target" value={target} />
              <label>
                Loại bằng chứng
                <select name="kind">
                  <option value="bank_txn_ref">Mã giao dịch ngân hàng</option>
                  <option value="note">Ghi chú</option>
                </select>
              </label>
              <label>
                Nội dung
                <input name="content" required maxLength={1000} />
              </label>
              <label>
                Giờ chuyển (tùy chọn, giờ Việt Nam)
                <input name="time" type="datetime-local" />
              </label>
            </ActionForm>
          )}
        </>
      )}
      {busy && <p role="status">Đang tải ảnh…</p>}
      {message && <p role="status">{message}</p>}
      {opened && !rows.length && <p>Chưa có bằng chứng.</p>}
      {rows.map((r) => (
        <div key={r.id}>
          <p>
            {r.bank_txn_ref || r.note || "Ảnh biên lai"} ·{" "}
            {new Date(r.created_at).toLocaleString("vi-VN", {
              timeZone: "Asia/Ho_Chi_Minh",
            })}
            {r.transferred_at
              ? " · Chuyển lúc " +
                new Date(r.transferred_at).toLocaleString("vi-VN", {
                  timeZone: "Asia/Ho_Chi_Minh",
                })
              : ""}
          </p>
          {r.status === "expired" ? (
            <p>Ảnh đã hết hạn lưu.</p>
          ) : (
            !r.bank_txn_ref &&
            !r.note && (
              <button
                className="secondary"
                type="button"
                onClick={async () => {
                  const result = await receiptLink(bucket, r.id);
                  if (result.url) setImage(result.url);
                  else setMessage(result.error || "Không lấy được ảnh.");
                }}
              >
                Mở ảnh
              </button>
            )
          )}
        </div>
      ))}
      {image && (
        <p>
          <a
            href={image}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Xem ảnh (mở tab mới)"
          >
            Xem ảnh
          </a>
        </p>
      )}
      {bucket === "3t-payment-evidence" && (
        <small>
          Ảnh biên lai được lưu 30 ngày sau khi xác nhận thanh toán.
        </small>
      )}
    </div>
  );
}
