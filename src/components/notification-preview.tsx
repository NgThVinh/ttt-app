"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, ArrowRight, RefreshCw } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { z } from "zod";
import { readNotification } from "@/app/notifications/read-actions";
import { safeAppPath } from "@/lib/notifications";

const schema = z.object({
  unread: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      href: z.string(),
      created_at: z.string(),
      read_at: z.string().nullable(),
    }),
  ),
});
export default function NotificationPreview() {
  const path = usePathname();
  const id = useId();
  const [data, setData] = useState<z.infer<typeof schema> | null>(null);
  const [error, setError] = useState(false);
  const [state, setState] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const open = state === "is-open";
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/notifications/preview", {
        cache: "no-store",
        signal: controller.signal,
      });
      const result = schema.safeParse(await response.json());
      if (controller.signal.aborted) return;
      if (!response.ok || !result.success) throw new Error("load");
      setData(result.data);
      setError(false);
    } catch {
      if (!controller.signal.aborted) setError(true);
    }
  }, []);
  const close = useCallback(() => {
    setState("is-closing");
    const ms = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--dropdown-close-dur",
          ),
        ) || 150;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(""), ms);
  }, []);
  useEffect(() => {
    if (
      ["/login", "/register", "/welcome"].includes(path) ||
      path.startsWith("/join/")
    )
      return;
    const initial = setTimeout(() => {
      void load();
    }, 0);
    const focus = () => {
      if (!document.hidden) void load();
    };
    const interval = setInterval(focus, 30000);
    window.addEventListener("focus", focus);
    window.addEventListener("3t-notifications-read", focus);
    const db = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
    let debounce: ReturnType<typeof setTimeout>;
    const channel = db
      .channel("notification-preview")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            void load();
          }, 300);
        },
      )
      .subscribe();
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      clearTimeout(debounce);
      window.removeEventListener("focus", focus);
      window.removeEventListener("3t-notifications-read", focus);
      request.current?.abort();
      void db.removeChannel(channel);
    };
  }, [path, load]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const focusOutside = (e: FocusEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", focusOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", focusOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, close]);
  async function markRead(target: string) {
    const form = new FormData();
    form.set("id", target);
    try {
      const result = await readNotification({ message: "" }, form);
      if (result.ok) window.dispatchEvent(new Event("3t-notifications-read"));
    } catch {
      /* Opening the destination must still work if marking read fails. */
    }
  }
  return (
    <div className="notification-preview" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="notification-trigger"
        aria-label={
          data?.unread ? `Thông báo · ${data.unread} chưa đọc` : "Thông báo"
        }
        title="Thông báo"
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        onClick={() => {
          if (open) close();
          else {
            clearTimeout(timer.current);
            setState("is-open");
            void load();
            requestAnimationFrame(() => panel.current?.focus());
          }
        }}
      >
        <Bell size={20} aria-hidden />
        {!error && !!data?.unread && (
          <span className="notification-count" aria-hidden>
            {data.unread > 99 ? "99+" : data.unread}
          </span>
        )}
      </button>
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-modal="false"
        aria-labelledby={id + "-title"}
        tabIndex={-1}
        data-origin="top-right"
        className={`t-dropdown notification-dropdown ${state}`}
        hidden={!state}
        inert={!open}
      >
        {state && (
          <>
            <div className="notification-preview-heading">
              <h2 id={id + "-title"}>Thông báo</h2>
              {!error && data && <span>{data.unread} chưa đọc</span>}
            </div>
            {error ? (
              <div className="notification-preview-state">
                <p role="alert">Chưa tải được thông báo.</p>
                <button
                  className="secondary"
                  onClick={() => {
                    void load();
                  }}
                >
                  <RefreshCw size={14} aria-hidden />
                  Thử lại
                </button>
              </div>
            ) : !data ? (
              <p className="notification-preview-state" role="status">
                Đang tải thông báo…
              </p>
            ) : !data.items.length ? (
              <p className="notification-preview-state">
                Bạn chưa có thông báo.
              </p>
            ) : (
              <ul className="notification-preview-list">
                {data.items.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={safeAppPath(n.href)}
                      className={!n.read_at ? "is-unread" : ""}
                      onClick={() => {
                        close();
                        if (!n.read_at) void markRead(n.id);
                      }}
                    >
                      <span className="notification-unread-dot" aria-hidden />
                      <div>
                        <strong>{n.title}</strong>
                        <time dateTime={n.created_at}>
                          {new Intl.DateTimeFormat("vi-VN", {
                            day: "numeric",
                            month: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Asia/Ho_Chi_Minh",
                          }).format(new Date(n.created_at))}
                          {!n.read_at && " · Chưa đọc"}
                        </time>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              className="notification-view-all"
              href="/notifications"
              onClick={close}
            >
              Xem tất cả <ArrowRight size={15} aria-hidden />
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
