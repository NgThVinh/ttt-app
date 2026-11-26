"use client";
import { useState } from "react";

export type SessionSuggestion = { venue?: string };
export default function SuggestedSessionDetails({
  groupName,
  date,
  suggestion = {},
}: {
  groupName: string;
  date?: string;
  suggestion?: SessionSuggestion;
}) {
  const [customTitle, setTitle] = useState<string>();
  const [venue, setVenue] = useState(suggestion.venue || "Chưa chọn sân");
  const title =
    customTitle ??
    `Buổi chơi ${groupName}${date ? ` · ${date.slice(8, 10)}/${date.slice(5, 7)}` : ""}`.slice(
      0,
      160,
    );
  return (
    <details className="suggested-details">
      <summary>
        <span>{title}</span>
        <small>{venue} · Bấm để sửa</small>
      </summary>
      <div className="compact-fields">
        <label>
          Tên buổi
          <input
            name="title"
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onInvalid={(e) => {
              e.currentTarget.closest("details")!.open = true;
            }}
          />
        </label>
        <label>
          Địa điểm
          <input
            name="venue"
            required
            maxLength={200}
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            onInvalid={(e) => {
              e.currentTarget.closest("details")!.open = true;
            }}
          />
        </label>
      </div>
      <p className="field-hint">
        {suggestion.venue
          ? "Gợi ý sân từ buổi gần nhất của nhóm."
          : "Chưa có sân quen. Bạn có thể bổ sung địa điểm sau."}
      </p>
    </details>
  );
}
