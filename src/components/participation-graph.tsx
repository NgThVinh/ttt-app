"use client";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import {
  participationWindow,
  weeklyFrequency,
  type ParticipationActivity,
} from "@/lib/participation-activity";
import { SlidingTabs } from "./ui/sliding-tabs";

function subscribe(callback: () => void) {
  const media = matchMedia("(max-width: 600px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const getWeeks = () => (matchMedia("(max-width: 600px)").matches ? 13 : 26);
const dateLabel = (day: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(day + "T12:00:00Z"));

export default function ParticipationGraph({
  activity,
}: {
  activity: ParticipationActivity;
}) {
  const weeks = useSyncExternalStore(subscribe, getWeeks, () => 26);
  const [mode, setMode] = useState("mine");
  const [selected, setSelected] = useState(activity.today);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const window = participationWindow(activity, weeks);
  const count = mode === "mine" ? window.mine : window.groupSessions;
  const active =
    window.days.find((d) => d.day === selected) ||
    window.days.find((d) => d.day === activity.today)!;
  const value = mode === "mine" ? active.mine : active.group_sessions;
  const label = mode === "mine" ? "buổi bạn tham gia" : "buổi của nhóm";
  return (
    <section
      className="panel participation-card"
      aria-labelledby={id + "-title"}
    >
      <div className="section-heading">
        <h2 id={id + "-title"}>Nhịp chơi</h2>
        <SlidingTabs
          value={mode}
          onChange={setMode}
          panelId={id}
          label="Hoạt động tham gia"
          options={[
            { value: "mine", label: "Cá nhân" },
            { value: "groups", label: "Nhóm" },
          ]}
        />
      </div>
      <div className="activity-summary">
        <p>
          <strong>{count}</strong> {label} <span>· {weeks} tuần qua</span>
        </p>
        <span>{weeklyFrequency(count, weeks)} buổi/tuần</span>
      </div>
      <div id={id} role="tabpanel" aria-labelledby={`${id}-${mode}`}>
        <div
          className="contribution-layout"
          style={{ "--activity-weeks": weeks } as React.CSSProperties}
        >
          <div className="contribution-weekdays" aria-hidden="true">
            {["T2", "", "T4", "", "T6", "", "CN"].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div>
            <div className="contribution-months" aria-hidden="true">
              {Array.from({ length: weeks }, (_, i) => {
                const day = window.days[i * 7].day;
                const previous = window.days[(i - 1) * 7]?.day;
                const next = window.days[(i + 1) * 7]?.day;
                const clippedFirstMonth =
                  i === 0 && next && next.slice(0, 7) !== day.slice(0, 7);
                return (
                  <span key={day}>
                    {!clippedFirstMonth &&
                    (!previous || previous.slice(0, 7) !== day.slice(0, 7))
                      ? `Th${Number(day.slice(5, 7))}`
                      : ""}
                  </span>
                );
              })}
            </div>
            <div
              className="contribution-grid"
              ref={root}
              role="group"
              aria-label={`Biểu đồ ${label} trong ${weeks} tuần`}
            >
              {window.days.map((d, index) => {
                const n = mode === "mine" ? d.mine : d.group_sessions;
                return (
                  <button
                    key={d.day}
                    type="button"
                    className="contribution-day"
                    data-day={d.day}
                    data-level={Math.min(n, 4)}
                    disabled={d.future}
                    aria-label={`${dateLabel(d.day)}: ${n} ${label}`}
                    aria-pressed={d.day === active.day}
                    title={`${dateLabel(d.day)} · ${n} ${label}`}
                    tabIndex={d.day === active.day ? 0 : -1}
                    onFocus={() => setSelected(d.day)}
                    onClick={() => setSelected(d.day)}
                    onPointerEnter={() => {
                      if (!d.future) setSelected(d.day);
                    }}
                    onKeyDown={(e) => {
                      const delta: Record<string, number> = {
                        ArrowLeft: -7,
                        ArrowRight: 7,
                        ArrowUp: -1,
                        ArrowDown: 1,
                        Home: -index,
                        End:
                          window.days.findIndex(
                            (x) => x.day === activity.today,
                          ) - index,
                      };
                      if (!(e.key in delta)) return;
                      e.preventDefault();
                      const target = window.days[index + delta[e.key]];
                      if (target && !target.future)
                        root.current
                          ?.querySelector<HTMLButtonElement>(
                            `[data-day="${target.day}"]`,
                          )
                          ?.focus();
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
        <div className="activity-detail">
          <span role="status">
            {dateLabel(active.day)} · {value} {label}
          </span>
          <span
            className="contribution-legend"
            aria-label="Màu đậm hơn tương ứng nhiều buổi hơn"
          >
            Ít{" "}
            {[0, 1, 2, 3, 4].map((n) => (
              <i key={n} data-level={n} />
            ))}{" "}
            Nhiều
          </span>
        </div>
      </div>
      <p className="activity-caption">
        {mode === "mine"
          ? `${window.activeWeeks}/${weeks} tuần có tham gia`
          : `${activity.group_count} nhóm bạn đang tham gia`}{" "}
        · Chỉ tính buổi đã diễn ra và chốt chi phí.
      </p>
    </section>
  );
}
