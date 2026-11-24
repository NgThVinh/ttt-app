"use client";
import Image from "next/image";
import { useState } from "react";
import { Copy } from "lucide-react";
import { vietQrUrl } from "@/lib/vietqr";
export default function PaymentQr({
  bin,
  account,
  amount,
  reference,
  name,
  compact = false,
}: {
  bin: string;
  account: string;
  amount: string;
  reference: string;
  name: string;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false),
    [message, setMessage] = useState("");
  const url = vietQrUrl(
    bin,
    account,
    amount,
    reference,
    name,
    process.env.NEXT_PUBLIC_VIETQR_TEMPLATE || "",
  );
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Đã sao chép.");
    } catch {
      setMessage(
        "Trình duyệt chưa cho phép sao chép. Bạn có thể chọn văn bản phía trên.",
      );
    }
  }
  return (
    <div className={compact ? "payment-qr compact" : undefined}>
      {url && !failed && (
        <Image
          unoptimized
          src={url}
          alt={`QR chuyển ${amount}đ, nội dung 3T-${reference}`}
          width={compact ? 156 : 240}
          height={compact ? 185 : 285}
          onError={() => setFailed(true)}
        />
      )}
      <div className="payment-qr-tools">
        <p>
          {!url || failed
            ? "QR chưa khả dụng. Dùng thông tin ngân hàng và các nút sao chép dưới đây."
            : "Kiểm tra tên người nhận trong app ngân hàng trước khi chuyển."}
        </p>
        <button
          type="button"
          className="secondary"
          aria-label="Sao chép tài khoản"
          onClick={() => copy(account)}
        >
          {compact && <Copy size={13} aria-hidden="true" />}
          {compact ? "Tài khoản" : "Sao chép tài khoản"}
        </button>{" "}
        <button
          type="button"
          className="secondary"
          aria-label="Sao chép số tiền"
          onClick={() => copy(amount)}
        >
          {compact && <Copy size={13} aria-hidden="true" />}
          {compact ? "Số tiền" : "Sao chép số tiền"}
        </button>{" "}
        <button
          type="button"
          className="secondary"
          aria-label="Sao chép nội dung"
          onClick={() => copy(`3T-${reference}`)}
        >
          {compact && <Copy size={13} aria-hidden="true" />}
          {compact ? "Nội dung" : "Sao chép nội dung"}
        </button>
        {message && <p role="status">{message}</p>}
      </div>
    </div>
  );
}
