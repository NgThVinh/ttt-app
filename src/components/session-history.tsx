"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { History, X } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { loadSessionHistory } from "@/app/sessions/actions";
import { historyLabels, type HistoryItem } from "@/lib/session-history";
export default function SessionHistory({ sid }: { sid: string }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    sentinel = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(""),
    [items, setItems] = useState<HistoryItem[]>([]),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const loading = useRef(false),
    generation = useRef(0),
    cursor = useRef<HistoryItem | undefined>(undefined),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const load = useCallback(
    async (reset = false) => {
      if (loading.current) return;
      loading.current = true;
      setBusy(true);
      setError("");
      const version = generation.current;
      try {
        const result = await loadSessionHistory(
          sid,
          reset
            ? null
            : cursor.current
              ? { created_at: cursor.current.created_at, id: cursor.current.id }
              : null,
        );
        if (version !== generation.current) return;
        if ("message" in result) {
          setError(result.message || "Chưa tải được lịch sử.");
          return;
        }
        cursor.current = result.items.at(-1);
        setItems((prior) =>
          reset
            ? result.items
            : [
                ...prior,
                ...result.items.filter(
                  (x) => !prior.some((p) => p.id === x.id),
                ),
              ],
        );
        setMore(result.has_more);
      } catch (cause) {
        unstable_rethrow(cause);
        if (version === generation.current)
          setError("Chưa tải được lịch sử. Hãy thử lại.");
      } finally {
        loading.current = false;
        setBusy(false);
      }
    },
    [sid],
  );
  useEffect(() => {
    if (state !== "is-open" || !more || error || busy) return;
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void load();
      },
      { root: scroll.current, rootMargin: "80px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [state, more, error, busy, load]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      generation.current++;
    },
    [],
  );
  function close() {
    setState("is-closing");
    const ms = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--modal-close-dur",
          ),
        ) || 150;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      dialog.current?.close();
      setState("");
      generation.current++;
    }, ms);
  }
  function open() {
    clearTimeout(timer.current);
    generation.current++;
    setItems([]);
    setMore(false);
    cursor.current = undefined;
    dialog.current?.showModal();
    requestAnimationFrame(() => setState("is-open"));
    void load(true);
  }
  return (
    <>
      <button
        type="button"
        className="secondary history-trigger"
        disabled={busy}
        aria-label="Lịch sử"
        title="Lịch sử"
        onClick={open}
      >
        <History size={17} aria-hidden="true" />{" "}
        <span className="history-label">Lịch sử</span>
      </button>
      <dialog
        ref={dialog}
        className="history-dialog"
        aria-labelledby={titleId}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className={`t-modal history-dialog-content ${state}`}>
          <header>
            <h2 id={titleId}>Lịch sử buổi chơi</h2>
            <button
              type="button"
              className="secondary"
              aria-label="Đóng lịch sử"
              onClick={close}
            >
              <X size={19} />
            </button>
          </header>
          <div
            ref={scroll}
            className="history-scroll"
            tabIndex={0}
            aria-label="Các thay đổi trong buổi"
          >
            <ol>
              {items.map((h) => (
                <li key={h.id}>
                  <strong>{historyLabels[h.action] || "Cập nhật buổi"}</strong>
                  <p>
                    {h.actor_name} ·{" "}
                    {new Date(h.created_at).toLocaleString("vi-VN", {
                      timeZone: "Asia/Ho_Chi_Minh",
                    })}
                  </p>
                  {h.reason && <p>{h.reason}</p>}
                </li>
              ))}
            </ol>
            {!busy && !items.length && !error && <p>Chưa có thay đổi nào.</p>}
            {busy && <p role="status">Đang tải lịch sử…</p>}
            {error && <p role="alert">{error}</p>}
            <div ref={sentinel} />
            {(more || error) && (
              <button
                className="secondary full"
                type="button"
                disabled={busy}
                onClick={() => void load(items.length === 0)}
              >
                {error ? "Thử tải lại" : "Tải thêm lịch sử"}
              </button>
            )}
            {!more && !!items.length && !busy && !error && (
              <p className="field-hint">Đã xem hết lịch sử.</p>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
