"use client";
import { useState, useTransition } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { votePoll } from "@/app/polls/actions";
export default function PollVoteButtons({
  optionId,
  answer,
}: {
  optionId: string;
  answer?: string;
}) {
  const [value, setValue] = useState(answer),
    [error, setError] = useState(""),
    [pending, startTransition] = useTransition();
  const router = useRouter();
  function choose(next: string) {
    const previous = value;
    setValue(next);
    setError("");
    startTransition(async () => {
      try {
        const form = new FormData();
        form.set("id", optionId);
        form.set("answer", next);
        const r = await votePoll({ message: "" }, form);
        if (!r.ok) {
          setValue(previous);
          setError(r.message);
        }
      } catch (e) {
        unstable_rethrow(e);
        setValue(previous);
        setError("Chưa lưu được lựa chọn. Hãy thử lại.");
      }
      router.refresh();
    });
  }
  return (
    <div className="poll-vote">
      <div role="group" aria-label="Lựa chọn của tôi" aria-busy={pending}>
        {[
          ["yes", "Đi được"],
          ["maybe", "Có thể"],
          ["no", "Không đi"],
        ].map(([key, label]) => (
          <button
            key={key}
            className="secondary"
            type="button"
            aria-pressed={value === key}
            disabled={pending}
            onClick={() => choose(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {pending && <small role="status">Đang lưu…</small>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
