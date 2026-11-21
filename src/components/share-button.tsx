"use client";
import { useState } from "react";
export default function ShareButton({
  title,
  text,
  path,
}: {
  title: string;
  text: string;
  path: string;
}) {
  const [message, setMessage] = useState("");
  async function share() {
    const url = new URL(path, window.location.origin).toString();
    const content = `${text}\n${url}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        setMessage("Đã mở chia sẻ. Chọn Messenger và nhóm bạn muốn gửi.");
      } else {
        await navigator.clipboard.writeText(content);
        setMessage("Đã sao chép. Dán nội dung vào nhóm Messenger nhé.");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(content);
        setMessage("Đã sao chép nội dung để bạn dán vào Messenger.");
      } catch {
        setMessage(
          "Chưa chia sẻ được. Bạn có thể sao chép đường dẫn trên thanh địa chỉ.",
        );
      }
    }
  }
  return (
    <div>
      <button className="secondary" type="button" onClick={share}>
        Chia sẻ lên Messenger / chat nhóm
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
