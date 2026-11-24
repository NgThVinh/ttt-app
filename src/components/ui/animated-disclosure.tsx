"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";

export function AnimatedDisclosure({
  title,
  children,
  className = "",
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={`t-acc ${className}`} data-open={String(open)}>
      <button
        type="button"
        className="t-acc-head"
        id={`${id}-trigger`}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen(!open)}
      >
        {title}
        <span className="t-acc-chevron" aria-hidden="true">
          <svg
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4 6L8 10L12 6" />
          </svg>
        </span>
      </button>
      <div
        className="t-acc-panel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-trigger`}
        aria-hidden={!open}
        inert={!open}
        onInvalidCapture={(event) => {
          setOpen(true);
          const target = event.target as HTMLElement;
          requestAnimationFrame(() => target.focus());
        }}
      >
        <div className="t-acc-panel-inner">
          <div className="disclosure-content">{children}</div>
        </div>
      </div>
    </div>
  );
}
