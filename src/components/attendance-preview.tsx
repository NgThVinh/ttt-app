"use client";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { Users } from "lucide-react";

const subscribe = () => () => {};
export default function AttendancePreview({
  going,
  pending,
  goingNames,
  pendingNames,
}: {
  going: number;
  pending: number;
  goingNames?: string[];
  pendingNames?: string[];
}) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const id = useId();
  const group = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLButtonElement | null>(null);
  const pointer = useRef("");
  const requested = useRef<HTMLButtonElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  function hide() {
    clearTimeout(hideTimer.current);
    tip.current?.setAttribute("data-show", "false");
    tip.current?.setAttribute("aria-hidden", "true");
    active.current = null;
    requested.current = null;
  }
  const place = useCallback((trigger: HTMLButtonElement) => {
    clearTimeout(hideTimer.current);
    requested.current = trigger;
    const bubble = tip.current;
    const text = bubble?.querySelector<HTMLElement>(".t-tt-text");
    if (!bubble || !text) return;
    const showing = bubble.dataset.show === "true";
    text.textContent = trigger.dataset.tooltip || "";
    const cs = getComputedStyle(bubble);
    const padding = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const width = Math.min(340, window.innerWidth - 24);
    text.style.width = `${width - padding}px`;
    const r = trigger.getBoundingClientRect();
    const x = Math.max(
      12,
      Math.min(
        r.left + r.width / 2 - width / 2,
        window.innerWidth - width - 12,
      ),
    );
    if (!showing) bubble.style.transition = "none";
    bubble.style.width = `${width}px`;
    bubble.style.setProperty("--tt-x", `${x}px`);
    const height = bubble.getBoundingClientRect().height;
    const top =
      r.bottom + height + 8 <= window.innerHeight - 12
        ? r.bottom + 8
        : Math.max(12, r.top - height - 8);
    bubble.style.top = `${top}px`;
    if (!showing) {
      void bubble.offsetWidth;
      bubble.style.transition = "";
    }
    bubble.setAttribute("data-show", "true");
    bubble.setAttribute("aria-hidden", "false");
    active.current = trigger;
  }, []);
  function deferHide() {
    clearTimeout(hideTimer.current);
    const delay = tip.current
      ? getComputedStyle(tip.current).getPropertyValue("--tt-delay").trim()
      : "0ms";
    const milliseconds = parseFloat(delay) * (delay.endsWith("ms") ? 1 : 1000);
    hideTimer.current = setTimeout(
      hide,
      Number.isFinite(milliseconds) ? milliseconds : 0,
    );
  }
  useEffect(() => {
    if (mounted && requested.current) place(requested.current);
  }, [mounted, place]);
  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      if (
        !group.current?.contains(e.target as Node) &&
        !tip.current?.contains(e.target as Node)
      )
        hide();
    };
    const scroll = (e: Event) => {
      if (!tip.current?.contains(e.target as Node)) hide();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", hide);
    return () => {
      clearTimeout(hideTimer.current);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", hide);
    };
  }, []);
  return (
    <span
      className="t-tt-group attendance-preview"
      ref={group}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        if (
          !(
            e.relatedTarget instanceof Node &&
            tip.current?.contains(e.relatedTarget)
          ) &&
          !group.current?.contains(document.activeElement)
        )
          deferHide();
      }}
    >
      <Users size={14} aria-hidden />
      {[
        {
          label: `${going} đi`,
          title: "Đã nhận lời",
          names: goingNames,
          empty: "Chưa ai nhận lời",
        },
        {
          label: `${pending} chờ`,
          title: "Chờ trả lời",
          names: pendingNames,
          empty: "Không còn ai chờ trả lời",
        },
      ].map((item) => (
        <button
          key={item.title}
          type="button"
          className="t-tt-trigger attendance-trigger"
          aria-label={`${item.label} · ${item.title}`}
          aria-describedby={id}
          data-tooltip={`${item.title}: ${item.names ? item.names.join(", ") || item.empty : "Chưa tải được danh sách"}`}
          onPointerDown={(e) => {
            pointer.current = e.pointerType;
          }}
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") place(e.currentTarget);
          }}
          onFocus={(e) => {
            if (pointer.current !== "touch") place(e.currentTarget);
          }}
          onBlur={(e) => {
            if (
              !tip.current?.contains(e.relatedTarget) &&
              !group.current?.contains(e.relatedTarget)
            )
              hide();
            pointer.current = "";
          }}
          onClick={(e) => {
            if (
              (pointer.current === "touch" || e.detail === 0) &&
              active.current === e.currentTarget
            )
              hide();
            else place(e.currentTarget);
          }}
        >
          {item.label}
        </button>
      ))}
      {mounted &&
        createPortal(
          <div
            className="t-tt roster-tooltip"
            id={id}
            ref={tip}
            role="tooltip"
            aria-hidden="true"
            data-show="false"
            onPointerEnter={() => clearTimeout(hideTimer.current)}
            onPointerLeave={(event) => {
              if (event.pointerType !== "mouse") return;
              if (!group.current?.contains(document.activeElement)) deferHide();
            }}
          >
            <span className="t-tt-text" />
          </div>,
          document.body,
        )}
    </span>
  );
}
