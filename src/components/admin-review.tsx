"use client";
import { useActionState } from "react";
import { previewAdmin, applyAdmin } from "@/app/sessions/admin-actions";
import type { SessionDetail } from "@/lib/session-data";
import { formatMoney } from "@/lib/money";
import ActionForm from "./action-form";
export default function AdminReview({
  session: s,
  command,
  body,
  reason,
  sourceId,
  disabled = false,
}: {
  session: SessionDetail;
  command: string;
  body: Record<string, unknown>;
  reason: string;
  sourceId: string | null;
  disabled?: boolean;
}) {
  const payload = JSON.stringify({
    sid: s.id,
    revision: s.revision,
    command,
    body,
    reason,
    source_id: sourceId,
  });
  const [state, submit, pending] = useActionState(previewAdmin, {
    message: "",
  });
  const reviewed =
    "payload" in state && state.payload === payload && state.detail;
  return (
    <div>
      <form action={submit}>
        <input type="hidden" name="payload" value={payload} />
        <button
          className="secondary"
          disabled={pending || disabled || !reason.trim()}
        >
          Xem trước thao tác dự phòng
        </button>
      </form>
      {state.message && <p role="status">{state.message}</p>}
      {reviewed && (
        <div className="split-preview">
          <h3>Phần chia sau thao tác</h3>
          {state.detail!.expenses.map((e) => (
            <div key={e.id}>
              <strong>
                {e.title}: {formatMoney(e.amount)}
              </strong>
              {e.allocations.map((p) => (
                <p key={p.member_id}>
                  {s.attendees.find((a) => a.member_id === p.member_id)?.name ||
                    "Thành viên"}
                  : {formatMoney(p.amount)}
                </p>
              ))}
            </div>
          ))}
          <h3>Các khoản còn phải chuyển</h3>
          {state
            .detail!.settlements.filter((p) => p.status !== "confirmed")
            .map((p) => (
              <p key={p.id}>
                {p.from_name} trả {p.to_name}: {formatMoney(p.amount)}
              </p>
            ))}
          <ActionForm action={applyAdmin} label="Xác nhận thực hiện dự phòng">
            <input type="hidden" name="id" value={state.id} />
            <input type="hidden" name="hash" value={state.hash} />
          </ActionForm>
        </div>
      )}
    </div>
  );
}
