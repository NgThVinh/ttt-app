"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
export default function AIChat({
  groups,
}: {
  groups: { id: string; name: string }[];
}) {
  const [group, setGroup] = useState(groups[0]?.id || ""),
    [message, setMessage] = useState(""),
    [reply, setReply] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null),
    router = useRouter();
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setReply("");
    setError("");
    abort.current = new AbortController();
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group, message }),
        signal: abort.current.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw Error(data.error || "Chưa gửi được. Thử lại sau.");
      }
      if (!response.body) throw Error("Không đọc được phản hồi.");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let text = "";
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        text += decoder.decode(part.value, { stream: true });
        setReply(text);
      }
      text += decoder.decode();
      setReply(
        text ||
          "Mở danh sách bản nháp bên dưới để xem kết quả. Chưa có thao tác ghi nào tự thực thi.",
      );
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "AbortError"
          ? e.message
          : "Đã dừng phản hồi. Kiểm tra bản nháp trước khi gửi lại.",
      );
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return (
    <section className="panel">
      <form onSubmit={send}>
        <label>
          Nhóm đang trò chuyện
          <select
            value={group}
            disabled={busy}
            onChange={(e) => {
              setGroup(e.target.value);
              setReply("");
              setError("");
            }}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bạn muốn làm gì?
          <textarea
            required
            maxLength={2000}
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tôi còn nợ ai? Ai chưa thanh toán?"
          />
        </label>
        <button className="primary" disabled={busy || !group}>
          {busy ? "Đang trả lời…" : "Gửi"}
        </button>
        {busy && (
          <button
            type="button"
            className="secondary"
            onClick={() => abort.current?.abort()}
          >
            Dừng
          </button>
        )}
      </form>
      {error && <p role="alert">{error}</p>}
      <div
        aria-live="polite"
        style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
      >
        {reply
          .split(
            /(\/(?:ai\/drafts|sessions|groups|polls)\/[a-f0-9-]{36}|\/ai\/settings|\/debts|\/me)(?=[\s.,!?)]|$)/g,
          )
          .map((part, index) =>
            /^\/(?:ai\/drafts\/[a-f0-9-]{36}|(?:sessions|groups|polls)\/[a-f0-9-]{36}|ai\/settings|debts|me)$/.test(
              part,
            ) ? (
              <Link
                key={index}
                href={part}
                style={{ textDecoration: "underline" }}
              >
                {part.startsWith("/ai/drafts/")
                  ? "Xem và xác nhận bản nháp"
                  : part === "/debts"
                    ? "Xem công nợ"
                    : part}
              </Link>
            ) : (
              part
            ),
          )}
      </div>
      <p>
        Mọi thay đổi đều cần xem và xác nhận bản nháp. Những yêu cầu cần người
        có quyền duyệt sẽ xuất hiện ở mục “Chờ tôi duyệt”.
      </p>
    </section>
  );
}
