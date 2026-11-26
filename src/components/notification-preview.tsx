"use client";
import Link from "@/components/app-link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, ArrowRight, RefreshCw } from "lucide-react";
import { subscribeToChanges } from "@/lib/live-data";
import { z } from "zod";
import { readNotification } from "@/app/notifications/read-actions";
import { safeAppPath } from "@/lib/notifications";

const schema = z.object({
  unread: z.number().int().nonnegative(),
  items: z
    .array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        href: z.string(),
        created_at: z.string(),
        read_at: z.string().nullable(),
      }),
    )
    .optional(),
});
export default function NotificationPreview() {
  const path = usePathname();
  const id = useId();
  const [data, setData] = useState<z.infer<typeof schema> | null>(null);
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState({ state: "", path });
  // Reset on navigation so browser Back cannot reopen an old dropdown.
  if (menu.path !== path) setMenu({ state: "", path });
  const state = menu.path === path ? menu.state : "";
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const requestedItems = useRef(false);
  const reload = useRef(false);
  const lastCount = useRef(0);
  const lastItems = useRef(0);
  const open = state === "is-open";
  const isOpen = useRef(false);
  useEffect(() => {
    isOpen.current = open;
  }, [open]);
  const load = useCallback(async function load(
    items = isOpen.current,
    force = false,
  ): Promise<void> {
    if (document.hidden || !navigator.onLine) return;
    const last = items ? lastItems.current : lastCount.current;
    if (!force && Date.now() - last < 60_000) return;
    if (inFlight.current && (!items || requestedItems.current)) {
      if (force) reload.current = true;
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    inFlight.current = true;
    requestedItems.current = items;
    try {
      const response = await fetch(
        "/api/notifications/preview" + (items ? "" : "?count=1"),
        {
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const result = schema.safeParse(await response.json());
      if (controller.signal.aborted) return;
      if (!response.ok || !result.success) throw new Error("load");
      const value = result.data;
      setData((previous) => ({
        unread: value.unread,
        items: value.items ?? previous?.items,
      }));
      lastCount.current = Date.now();
      if (items) lastItems.current = Date.now();
      setError(false);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (request.current === controller) {
        inFlight.current = false;
        if (reload.current && !controller.signal.aborted) {
          reload.current = false;
          void load(isOpen.current, true);
        }
      }
    }
  }, []);
  const close = useCallback(() => {
    setMenu((current) => ({ ...current, state: "is-closing" }));
    const ms = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--dropdown-close-dur",
          ),
        ) || 150;
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setMenu((current) => ({ ...current, state: "" })),
      ms,
    );
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => {
      void load(false);
    }, 0);
    const changed = () => {
      lastItems.current = 0;
      void load(isOpen.current, true);
    };
    const unsubscribe = subscribeToChanges(["notifications"], changed);
    window.addEventListener("3t-notifications-read", changed);
    return () => {
      clearTimeout(initial);
      window.removeEventListener("3t-notifications-read", changed);
      request.current?.abort();
      inFlight.current = false;
      reload.current = false;
      unsubscribe();
    };
  }, [load]);
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
            setMenu({ state: "is-open", path });
            void load(true);
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
                    void load(true, true);
                  }}
                >
                  <RefreshCw size={14} aria-hidden />
                  Thử lại
                </button>
              </div>
            ) : !data?.items ? (
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
