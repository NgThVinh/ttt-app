"use client";
import { useState } from "react";
import ActionForm from "./action-form";
import { createPoll } from "@/app/polls/actions";
export default function PollForm({
  groups,
}: {
  groups: { id: string; name: string }[];
}) {
  const [rows, setRows] = useState([0, 1]);
  const [next, setNext] = useState(2);
  return (
    <section className="panel">
      <ActionForm action={createPoll} label="Tạo thăm dò">
        <label htmlFor="poll-group">Nhóm</label>
        <select id="poll-group" name="group">
          {groups.map((g) => (
            <option value={g.id} key={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <label htmlFor="poll-title">Tên thăm dò</label>
        <input id="poll-title" name="title" required maxLength={160} />
        <label htmlFor="poll-venue">Địa điểm</label>
        <input id="poll-venue" name="venue" required maxLength={200} />
        <label htmlFor="poll-min">Số người đồng ý tối thiểu</label>
        <input
          id="poll-min"
          name="minimum"
          type="number"
          min="1"
          max="100"
          defaultValue="2"
          required
        />
        <label htmlFor="poll-deadline">Hạn trả lời (giờ Việt Nam)</label>
        <input
          id="poll-deadline"
          name="deadline"
          type="datetime-local"
          required
        />
        {rows.map((r, i) => (
          <fieldset key={r}>
            <legend>Khung giờ {i + 1}</legend>
            <label htmlFor={`starts-${r}`}>Bắt đầu</label>
            <input
              id={`starts-${r}`}
              name="starts"
              type="datetime-local"
              required
            />
            <label htmlFor={`ends-${r}`}>Kết thúc</label>
            <input
              id={`ends-${r}`}
              name="ends"
              type="datetime-local"
              required
            />
            {rows.length > 1 && (
              <button
                type="button"
                className="secondary"
                onClick={() => setRows((v) => v.filter((n) => n !== r))}
              >
                Bỏ khung giờ
              </button>
            )}
          </fieldset>
        ))}
        {rows.length < 24 && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setRows((v) => [...v, next]);
              setNext((n) => n + 1);
            }}
          >
            Thêm khung giờ
          </button>
        )}
      </ActionForm>
    </section>
  );
}
