"use client";
import { useState } from "react";
import ActionForm from "./action-form";
import { createPoll } from "@/app/polls/actions";
import DateTimeField from "./ui/date-time-field";
import SuggestedSessionDetails, {
  type SessionSuggestion,
} from "./suggested-session-details";
export default function PollForm({
  groups,
  suggestions = {},
}: {
  groups: { id: string; name: string }[];
  suggestions?: Record<string, SessionSuggestion>;
}) {
  const [group, setGroup] = useState(groups[0].id);
  const [rows, setRows] = useState([0, 1]);
  const [next, setNext] = useState(2);
  return (
    <section className="panel poll-form">
      <ActionForm action={createPoll} label="Tạo thăm dò">
        <label htmlFor="poll-group">Nhóm</label>
        <select
          id="poll-group"
          name="group"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
        >
          {groups.map((g) => (
            <option value={g.id} key={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <SuggestedSessionDetails
          key={group}
          groupName={groups.find((g) => g.id === group)?.name || "cùng nhóm"}
          suggestion={suggestions[group]}
          poll
        />
        <div className="compact-fields">
          <div>
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
          </div>
          <div>
            <DateTimeField
              id="poll-deadline"
              name="deadline"
              label="Hạn trả lời (giờ Việt Nam)"
              required
            />
          </div>
        </div>
        <h3>Chọn các khung giờ · {rows.length} lựa chọn</h3>
        <div className="poll-options-grid">
          {rows.map((r, i) => (
            <fieldset key={r}>
              <legend>Khung giờ {i + 1}</legend>
              <div className="compact-fields">
                <div>
                  <DateTimeField
                    id={`starts-${r}`}
                    name="starts"
                    label="Bắt đầu"
                    required
                  />
                </div>
                <div>
                  <DateTimeField
                    id={`ends-${r}`}
                    name="ends"
                    label="Kết thúc"
                    required
                  />
                </div>
              </div>
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
        </div>
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
