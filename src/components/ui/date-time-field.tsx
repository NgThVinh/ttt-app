"use client";
import { useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Calendar } from "./calendar";
import { vietnamToday } from "@/lib/calendar";

export default function DateTimeField({
  id,
  name,
  label,
  value,
  onChange,
  required = false,
}: {
  id: string;
  name: string;
  label: string;
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
}) {
  const [local, setLocal] = useState("");
  const current = value ?? local;
  const details = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  function update(next: string) {
    setLocal(next);
    onChange?.(next);
  }
  return (
    <div className="date-time-field">
      <label htmlFor={id}>{label}</label>
      <div className="date-time-controls">
        <input
          id={id}
          name={name}
          type="datetime-local"
          required={required}
          value={current}
          onChange={(event) => update(event.target.value)}
        />
        <details
          ref={details}
          className="date-picker"
          onBlurCapture={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              requestAnimationFrame(() => {
                if (
                  details.current &&
                  !details.current.contains(document.activeElement)
                )
                  details.current.open = false;
              });
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              details.current!.open = false;
              trigger.current?.focus();
            }
          }}
        >
          <summary
            ref={trigger}
            aria-label={`Mở lịch: ${label}`}
            title="Chọn ngày trên lịch"
          >
            <CalendarDays size={20} />
          </summary>
          <div className="date-picker-panel">
            <Calendar
              key={current.slice(0, 7)}
              today={vietnamToday()}
              value={current.slice(0, 10) || undefined}
              onChange={(day) => {
                update(day + "T" + (current.slice(11) || "18:00"));
                details.current!.open = false;
                trigger.current?.focus();
              }}
            />
            <small>Giờ được giữ riêng; bạn có thể sửa ở ô ngày giờ.</small>
          </div>
        </details>
      </div>
    </div>
  );
}
