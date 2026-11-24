"use client";
import { useState, useTransition } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { sessionCommand } from "@/app/sessions/actions";
import type { Rsvp } from "@/lib/session-overview";
import { Check, Plus } from "lucide-react";

export default function RsvpButtons({
  sid,
  revision,
  value = "pending",
}: {
  sid: string;
  revision: string;
  value?: Rsvp;
}) {
  const [choice, setChoice] = useState(value);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function choose(next: "going" | "not_going") {
    const previous = choice;
    setChoice(next);
    setError("");
    startTransition(async () => {
      try {
        const form = new FormData();
        form.set("sid", sid);
        form.set("revision", revision);
        form.set("operation", next);
        const result = await sessionCommand({ message: "" }, form);
        if (!result.ok) {
          setChoice(previous);
          setError(result.message);
        }
        router.refresh();
      } catch (cause) {
        unstable_rethrow(cause);
        setChoice(previous);
        setError("Chưa nhận được kết quả. Kiểm tra kết nối và thử lại.");
        router.refresh();
      }
    });
  }
  return (
    <div className="rsvp-control">
      <div
        className="rsvp-buttons"
        role="group"
        aria-label="Tôi tham gia"
        aria-busy={pending}
      >
        <button
          type="button"
          className="secondary rsvp-toggle"
          aria-pressed={choice === "going"}
          title={
            choice === "going" ? "Rút khỏi buổi chơi" : "Tham gia buổi chơi"
          }
          disabled={pending}
          onClick={() => choose(choice === "going" ? "not_going" : "going")}
        >
          {choice === "going" ? (
            <Check size={16} aria-hidden="true" />
          ) : (
            <Plus size={16} aria-hidden="true" />
          )}
          {choice === "going" ? "Đã tham gia" : "Tham gia"}
        </button>
      </div>
      {pending && <small role="status">Đang lưu…</small>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
