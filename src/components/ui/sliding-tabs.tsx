"use client";

import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

export function SlidingTabs({
  value,
  onChange,
  options,
  label,
  panelId,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; icon?: ReactNode }[];
  label: string;
  panelId: string;
  className?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  function position(animate: boolean) {
    const root = bar.current;
    const active = root?.querySelector<HTMLButtonElement>(
      '[aria-selected="true"]',
    );
    const pill = root?.querySelector<HTMLElement>(".t-tabs-pill");
    if (!root || !active || !pill) return;
    const previous = pill.style.transition;
    if (!animate) pill.style.transition = "none";
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
    pill.style.width = `${active.offsetWidth}px`;
    if (!animate) {
      void pill.offsetWidth;
      pill.style.transition = previous;
    }
    root.dataset.ready = "true";
  }
  useLayoutEffect(() => {
    position(false);
    initialized.current = true;
    const observer = new ResizeObserver(() => position(false));
    if (bar.current) observer.observe(bar.current);
    let mounted = true;
    void document.fonts.ready.then(() => {
      if (mounted) position(false);
    });
    return () => {
      mounted = false;
      observer.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    position(initialized.current);
  }, [value]);
  return (
    <div
      ref={bar}
      className={`t-tabs ${className}`}
      role="tablist"
      aria-label={label}
    >
      <span className="t-tabs-pill" aria-hidden="true" />
      {options.map((option, index) => (
        <button
          type="button"
          key={option.value}
          className="t-tab"
          role="tab"
          id={`${panelId}-${option.value}`}
          aria-controls={panelId}
          aria-selected={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            let next: number;
            if (event.key === "ArrowRight") next = (index + 1) % options.length;
            else if (event.key === "ArrowLeft")
              next = (index + options.length - 1) % options.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = options.length - 1;
            else return;
            event.preventDefault();
            onChange(options[next].value);
            bar.current
              ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
              [next]?.focus();
          }}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
