"use client";
import { useActionState } from "react";
import Link from "next/link";
import ActionForm from "./action-form";
import { previewApproval, decideApproval } from "@/app/approvals/actions";
import type { SessionDetail } from "@/lib/session-data";
import { formatMoney } from "@/lib/money";
export type Approval = {
  id: string;
  session_id: string;
  type: string;
  payload_hash: string;
  payload: Record<string, unknown>;
  requested_by: string;
  required_authority: string;
  expires_at: string;
  status: string;
  source: string;
};
const labels: Record<string, string> = {
  join: "Xin thêm vào buổi",
  leave: "Xin rút khỏi buổi",
  weight: "Đề nghị hệ số",
  expense_proposal: "Phụ phí đề xuất",
  collector_nomination: "Đề cử người tính tiền",
};
export default function ApprovalCard({
  request: r,
  canDecide,
  canCancel,
  summary,
}: {
  request: Approval;
  canDecide: boolean;
  canCancel: boolean;
  summary: string;
}) {
  const [state, preview, pending] = useActionState<
    { message: string; detail?: SessionDetail },
    FormData
  >(previewApproval, { message: "" });
  const phase =
    r.payload.phase === "consent"
      ? "Cần người tính tiền hiện tại đồng ý"
      : r.type === "collector_nomination"
        ? "Cần người được đề cử nhận vai trò"
        : "";
  return (
    <section className="panel">
      <h2>{labels[r.type] || "Yêu cầu"}</h2>
      <p>{summary}</p>
      <p>{typeof r.payload.reason === "string" ? r.payload.reason : ""}</p>
      {typeof r.payload.title === "string" && (
        <p>
          {r.payload.title} ·{" "}
          {typeof r.payload.amount === "string"
            ? formatMoney(r.payload.amount)
            : ""}{" "}
          {r.payload.mode === "per_person" ? "mỗi người" : ""}
        </p>
      )}
      {typeof r.payload.weight === "string" && (
        <p>Hệ số đề nghị: {r.payload.weight}</p>
      )}
      <p>
        {phase} · Nguồn {r.source === "ai" ? "AI" : "app"} · Hết hạn{" "}
        {new Date(r.expires_at).toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
        })}
      </p>
      {canDecide && (
        <>
          {r.type === "collector_nomination" &&
            r.payload.phase === "accept" && (
              <p>
                Trước khi nhận vai trò, hãy lưu thông tin ngân hàng trong{" "}
                <Link href="/me">hồ sơ của tôi</Link>.
              </p>
            )}
          <form action={preview}>
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="hash" value={r.payload_hash} />
            <button className="secondary" disabled={pending}>
              Xem trước nội dung sẽ duyệt
            </button>
          </form>
          {state.message && <p role="status">{state.message}</p>}
          {state.detail && (
            <>
              <h3>Phần chia sau thay đổi</h3>
              {state.detail.expenses.map((e) => (
                <div key={e.id}>
                  <strong>
                    {e.title} · {formatMoney(e.amount)}
                  </strong>
                  {e.allocations.map((a) => (
                    <p key={a.member_id}>
                      {state.detail!.attendees.find(
                        (m) => m.member_id === a.member_id,
                      )?.name || "Thành viên"}
                      : {formatMoney(a.amount)}
                    </p>
                  ))}
                </div>
              ))}
              <h3>Các khoản còn cần chuyển</h3>
              {state.detail.settlements
                .filter((p) => p.status !== "confirmed")
                .map((p) => (
                  <p key={p.id}>
                    {p.from_name} trả {p.to_name}: {formatMoney(p.amount)}
                  </p>
                ))}
              <ActionForm
                action={decideApproval}
                label={
                  r.type === "collector_nomination"
                    ? "Đồng ý bước đề cử / nhận vai trò"
                    : "Duyệt thay đổi"
                }
              >
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="hash" value={r.payload_hash} />
                <input type="hidden" name="decision" value="approve" />
              </ActionForm>
            </>
          )}
          <ActionForm action={decideApproval} label="Từ chối">
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="hash" value={r.payload_hash} />
            <input type="hidden" name="decision" value="reject" />
          </ActionForm>
        </>
      )}
      {canCancel && (
        <ActionForm action={decideApproval} label="Hủy yêu cầu của tôi">
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="hash" value={r.payload_hash} />
          <input type="hidden" name="decision" value="cancel" />
        </ActionForm>
      )}
    </section>
  );
}
