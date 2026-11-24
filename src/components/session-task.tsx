"use client";
import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";

export default function SessionTask({
  label,
  title,
  children,
  secondary = false,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
  secondary?: boolean;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState("");
  useEffect(() => () => clearTimeout(timer.current), []);
  function open() {
    clearTimeout(timer.current);
    dialog.current?.showModal();
    requestAnimationFrame(() => setState("is-open"));
  }
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
      trigger.current?.focus();
    }, ms);
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`session-task-trigger ${secondary ? "secondary" : "primary"}`}
        aria-haspopup="dialog"
        onClick={open}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        className="session-task-dialog"
        aria-labelledby={id}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className={`t-modal session-task-content ${state}`}>
          <div className="session-task-heading">
            <h2 id={id}>{title}</h2>
            <button
              type="button"
              className="secondary"
              aria-label="Đóng"
              onClick={close}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="session-task-body">{children}</div>
        </div>
      </dialog>
    </>
  );
}
