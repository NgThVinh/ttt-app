"use client";
import Image from "next/image";
import { useState } from "react";
import { vietQrUrl } from "@/lib/vietqr";
export default function PaymentQr({
  bin,
  account,
  amount,
  reference,
  name,
}: {
  bin: string;
  account: string;
  amount: string;
  reference: string;
  name: string;
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
    <div>
      {url && !failed && (
        <Image
          unoptimized
          src={url}
          alt={`QR chuyển ${amount}đ, nội dung 3T-${reference}`}
          width={240}
          height={285}
          onError={() => setFailed(true)}
        />
      )}
      <p>
        {!url || failed
          ? "QR chưa khả dụng. Dùng thông tin ngân hàng và các nút sao chép dưới đây."
          : "Kiểm tra tên người nhận trong app ngân hàng trước khi chuyển."}
      </p>
      <button type="button" className="secondary" onClick={() => copy(account)}>
        Sao chép tài khoản
      </button>{" "}
      <button type="button" className="secondary" onClick={() => copy(amount)}>
        Sao chép số tiền
      </button>{" "}
      <button
        type="button"
        className="secondary"
        onClick={() => copy(`3T-${reference}`)}
      >
        Sao chép nội dung
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
