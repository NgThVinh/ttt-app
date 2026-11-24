"use client";
import { useState } from "react";
import ActionForm from "./action-form";
import { createPoll } from "@/app/polls/actions";
import { pollLocalTime } from "@/lib/poll-draft";
export default function PollForm({
  groups,
  suggestions = {},
  initialTime,
}: {
  groups: { id: string; name: string }[];
  suggestions?: Record<string, { venue: string }>;
  initialTime: string;
}) {
  const [group, setGroup] = useState(groups[0].id),
    [title, setTitle] = useState(""),
    [venue, setVenue] = useState("");
  const tomorrow = pollLocalTime(
    new Date(Date.parse(initialTime) + 86400000).toISOString(),
  ).slice(0, 10);
  const [rows, setRows] = useState([
    { id: 0, start: tomorrow + "T18:00", end: tomorrow + "T20:00" },
    { id: 1, start: tomorrow + "T20:00", end: tomorrow + "T22:00" },
  ]);
  const [next, setNext] = useState(2),
    [deadline, setDeadline] = useState("");
  const first = rows.map((r) => r.start).sort()[0] || "",
    bad =
      rows.some((r) => !r.start || !r.end || r.end <= r.start) ||
      !!(deadline && first && deadline > first);
  const actualTitle =
    title ||
    `Chọn lịch · ${groups.find((g) => g.id === group)?.name || "nhóm bạn"}`.slice(
      0,
      160,
    );
  const actualVenue = venue || suggestions[group]?.venue || "Chưa chọn sân";
  function change(id: number, patch: Partial<(typeof rows)[number]>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  return (
    <section className="panel poll-composer">
      <ActionForm
        action={createPoll}
        label="Gửi thăm dò"
        disabled={bad}
        disabledReason="Chọn giờ kết thúc sau giờ bắt đầu; hạn trả lời không muộn hơn khung đầu tiên."
      >
        <div className="compact-fields">
          <label>
            Nhóm
            <select
              name="group"
              aria-label="Nhóm"
              value={group}
              onChange={(e) => {
                setGroup(e.target.value);
                setTitle("");
                setVenue("");
              }}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tên thăm dò
            <input
              name="title"
              value={actualTitle}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              required
            />
          </label>
        </div>
        <fieldset className="poll-time-options">
          <legend>Các lựa chọn</legend>
          {rows.map((r, i) => (
            <div className="poll-time-row" key={r.id}>
              <span className="poll-option-index">{i + 1}</span>
              <label>
                Bắt đầu
                <input
                  type="datetime-local"
                  name="starts"
                  value={r.start}
                  required
                  onChange={(e) => {
                    const v = e.target.value;
                    const duration =
                      Date.parse(r.end + ":00+07:00") -
                      Date.parse(r.start + ":00+07:00");
                    let end = r.end;
                    if (
                      Number.isFinite(Date.parse(v + ":00+07:00")) &&
                      duration > 0
                    )
                      end = pollLocalTime(
                        new Date(
                          Date.parse(v + ":00+07:00") + duration,
                        ).toISOString(),
                      );
                    change(r.id, { start: v, end });
                  }}
                />
              </label>
              <label>
                Kết thúc
                <input
                  type="datetime-local"
                  name="ends"
                  value={r.end}
                  required
                  onChange={(e) => change(r.id, { end: e.target.value })}
                />
              </label>
              <button
                className="secondary"
                type="button"
                disabled={rows.length === 1}
                aria-label={`Bỏ khung giờ ${i + 1}`}
                onClick={() =>
                  setRows((prev) => prev.filter((row) => row.id !== r.id))
                }
              >
                Bỏ
              </button>
            </div>
          ))}
        </fieldset>
        <button
          className="secondary"
          type="button"
          disabled={rows.length >= 24}
          onClick={() => {
            const last = rows.at(-1)!;
            setRows((prev) => [
              ...prev,
              {
                id: next,
                start: Number.isFinite(Date.parse(last.start + ":00+07:00"))
                  ? pollLocalTime(
                      new Date(
                        Date.parse(last.start + ":00+07:00") + 86400000,
                      ).toISOString(),
                    )
                  : tomorrow + "T18:00",
                end: Number.isFinite(Date.parse(last.end + ":00+07:00"))
                  ? pollLocalTime(
                      new Date(
                        Date.parse(last.end + ":00+07:00") + 86400000,
                      ).toISOString(),
                    )
                  : tomorrow + "T20:00",
              },
            ]);
            setNext((n) => n + 1);
          }}
        >
          + Thêm khung giờ
        </button>
        <details className="poll-extra-settings">
          <summary>Địa điểm và hạn trả lời</summary>
          <div className="compact-fields">
            <label>
              Địa điểm dự kiến
              <input
                name="venue"
                value={actualVenue}
                onChange={(e) => setVenue(e.target.value)}
                required
                maxLength={200}
              />
            </label>
            <label>
              Hạn trả lời
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
              <small>Mặc định trước khung giờ đầu tiên.</small>
            </label>
          </div>
        </details>
        <input type="hidden" name="deadline" value={deadline || first} />
      </ActionForm>
    </section>
  );
}
