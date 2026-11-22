"use client";
import { useState, useActionState, useId } from "react";
import type { SessionDetail } from "@/lib/session-data";
import { formatMoney } from "@/lib/money";
import { previewChange, applyChange } from "@/app/sessions/actions";
import ActionForm from "./action-form";
import AdminReview from "./admin-review";
type PreviewResult = {
  message: string;
  detail?: SessionDetail;
  payload?: string;
};
export default function FinancialChangeForm({
  session: s,
  members,
  administrative,
}: {
  session: SessionDetail;
  members: { id: string; display_name: string }[];
  administrative?: { sourceId: string | null };
}) {
  const formId = useId();
  const [action, setAction] = useState("attendee"),
    [target, setTarget] = useState(members[0]?.id || ""),
    [operation, setOperation] = useState("weight"),
    [weight, setWeight] = useState("0.5"),
    [expense, setExpense] = useState(s.expenses[0]?.id || ""),
    [reason, setReason] = useState("");
  const payload = JSON.stringify({
    sid: s.id,
    revision: s.revision,
    action,
    body:
      action === "attendee"
        ? { member_id: target, operation, weight, reason }
        : { expense_id: expense, reason },
  });
  const [state, submit, pending] = useActionState<PreviewResult, FormData>(
    previewChange,
    { message: "" },
  );
  const reviewed = state.detail && state.detail.revision !== s.revision;
  return (
    <section className="panel">
      <h2>Sửa người, hệ số hoặc xóa khoản chi</h2>
      <form
        action={submit}
        key={s.revision}
        onSubmit={(e) => {
          if (administrative) e.preventDefault();
        }}
      >
        <input type="hidden" name="payload" value={payload} />
        <label htmlFor={`${formId}-action`}>Thay đổi</label>
        <select
          id={`${formId}-action`}
          value={action}
          onChange={(e) => setAction(e.target.value)}
        >
          <option value="attendee">Người tham gia / hệ số</option>
          <option value="delete_expense">Xóa khoản chi (giữ lịch sử)</option>
        </select>
        {action === "attendee" ? (
          <>
            <label htmlFor={`${formId}-member`}>Thành viên</label>
            <select
              id={`${formId}-member`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
            <label htmlFor={`${formId}-operation`}>Thao tác</label>
            <select
              id={`${formId}-operation`}
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
            >
              <option value="weight">Đổi hệ số</option>
              <option value="remove">Rút khỏi buổi</option>
              <option value="add">Thêm vào buổi</option>
            </select>
            {operation === "weight" && (
              <>
                <label htmlFor={`${formId}-weight`}>Hệ số mới</label>
                <input
                  id={`${formId}-weight`}
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                />
              </>
            )}
          </>
        ) : (
          <>
            <label htmlFor={`${formId}-expense`}>Khoản chi</label>
            <select
              id={`${formId}-expense`}
              value={expense}
              onChange={(e) => setExpense(e.target.value)}
            >
              {s.expenses.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} · {formatMoney(e.amount)}
                </option>
              ))}
            </select>
          </>
        )}
        <label htmlFor={`${formId}-reason`}>Lý do</label>
        <input
          id={`${formId}-reason`}
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {!administrative && (
          <button
            className="secondary"
            disabled={pending}
            style={{ marginTop: 16 }}
          >
            Xem trước thay đổi
          </button>
        )}
      </form>
      {administrative && (
        <AdminReview
          session={s}
          command="apply_financial_change"
          body={{ action_name: action, body: JSON.parse(payload).body }}
          reason={reason}
          sourceId={administrative.sourceId}
        />
      )}
      {state.message && <p role="status">{state.message}</p>}
      {reviewed && state.payload === payload && (
        <>
          <h3>Công nợ sau thay đổi</h3>
          {state
            .detail!.settlements.filter((p) => p.status !== "confirmed")
            .map((p) => (
              <p key={p.id}>
                {p.from_name} trả {p.to_name}:{" "}
                <strong>{formatMoney(p.amount)}</strong>
              </p>
            ))}
          <p>
            Các khoản đã xác nhận được giữ nguyên. Thay đổi chỉ được lưu khi bấm
            nút dưới đây.
          </p>
          <ActionForm action={applyChange} label="Xác nhận lưu thay đổi">
            <input type="hidden" name="payload" value={payload} />
          </ActionForm>
        </>
      )}
    </section>
  );
}
