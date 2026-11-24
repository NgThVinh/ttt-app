"use client";
import { useEffect, useRef, useState } from "react";
import { UserPlus } from "lucide-react";
export default function SessionInvite({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [closing, setClosing] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function close() {
    setOpen(false);
    setClosing(true);
    const ms =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--dropdown-close-dur",
        ),
      ) || 150;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setClosing(false), ms);
  }
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
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
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div ref={root} className="session-invite">
      <button
        ref={trigger}
        className="secondary"
        type="button"
        aria-expanded={open}
        aria-controls="session-invite-menu"
        onClick={() => {
          if (open) close();
          else {
            clearTimeout(timer.current);
            setClosing(false);
            setOpen(true);
          }
        }}
      >
        <UserPlus size={17} aria-hidden="true" /> Mời thêm người tham gia
      </button>
      <div
        id="session-invite-menu"
        className={`t-dropdown invite-dropdown ${open ? "is-open" : closing ? "is-closing" : ""}`}
        hidden={!open && !closing}
        inert={!open}
        data-origin="top-right"
      >
        {children}
      </div>
    </div>
  );
}
