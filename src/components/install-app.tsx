"use client";
import { useEffect, useState } from "react";
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
export default function InstallApp() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const ready = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    const installed = () => {
      setPrompt(null);
      setMessage("Đã cài 3T. Bạn có thể mở app từ Màn hình chính.");
    };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  async function install() {
    if (!prompt) return;
    setBusy(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setMessage(
        choice.outcome === "accepted"
          ? "Đang cài 3T…"
          : "Bạn có thể cài sau từ menu trình duyệt.",
      );
      setPrompt(null);
    } catch {
      setMessage(
        "Chưa mở được hướng dẫn cài đặt. Bạn có thể dùng menu trình duyệt.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Mở 3T từ Màn hình chính</h2>
      <p>Cài app để mở nhanh và bật nhắc lịch trên thiết bị này.</p>
      {prompt && (
        <button
          className="primary"
          type="button"
          onClick={install}
          disabled={busy}
        >
          {busy ? "Đang mở…" : "Cài 3T"}
        </button>
      )}
      <details>
        <summary>Hướng dẫn cài trên điện thoại</summary>
        <p>
          <strong>iPhone/iPad:</strong> mở 3T trong Safari, chọn Chia sẻ → Thêm
          vào Màn hình chính → Thêm.
        </p>
        <p>
          <strong>Android:</strong> mở menu trình duyệt, chọn Cài đặt ứng dụng
          hoặc Thêm vào Màn hình chính.
        </p>
        <p>
          Mở từ biểu tượng 3T, sau đó bật thông báo ở phần bên dưới. Bạn vẫn
          dùng được 3T trong trình duyệt.
        </p>
      </details>
      <p role="status">{message}</p>
    </section>
  );
}
