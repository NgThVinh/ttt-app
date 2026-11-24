"use client";
import ActionForm from "./action-form";
import { sessionCommand } from "@/app/sessions/actions";
import { requestChange, decideApproval } from "@/app/approvals/actions";
import Link from "next/link";
import type { SessionDetail } from "@/lib/session-data";
export type CollectorRequest = {
  id: string;
  payload_hash: string;
  required_authority: string;
  payload: { member_id?: string };
};
export default function SessionCollector({
  session: s,
  members,
  request,
}: {
  session: SessionDetail;
  members: { id: string; display_name: string; user_id: string | null }[];
  request?: CollectorRequest;
}) {
  const current = members.find((m) => m.id === s.collector_member_id),
    authority = members.find((m) => m.id === request?.required_authority),
    mine = s.collector_member_id === s.my_member_id;
  const claim = (
    <ActionForm
      action={s.collector_member_id ? requestChange : sessionCommand}
      label="Gán cho tôi"
    >
      <input type="hidden" name="sid" value={s.id} />
      <input type="hidden" name="revision" value={s.revision} />
      <input type="hidden" name="operation" value="claim" />
      <input type="hidden" name="court" value="0" />
      <input type="hidden" name="kind" value="collector_nomination" />
      <input type="hidden" name="member_id" value={s.my_member_id} />
      <input
        type="hidden"
        name="reason"
        value="Tôi muốn nhận vai trò tính tiền"
      />
    </ActionForm>
  );
  return (
    <div className="collector-control">
      <div className="collector-summary">
        <span>{s.status === "planned" ? "Tính tiền" : "Người tính tiền"}</span>
        <strong>
          {mine ? "Bạn" : current?.display_name || "Chưa có người nhận"}
        </strong>
      </div>
      {s.status === "planned" && !request && (
        <div className="collector-actions">
          {!s.collector_member_id && claim}
          <details className="collector-change">
            <summary>
              {s.collector_member_id
                ? "Đổi người tính tiền"
                : "Chọn người khác"}
            </summary>
            {s.collector_member_id && !mine && claim}
            <ActionForm action={requestChange} label="Mời tính tiền">
              <input type="hidden" name="sid" value={s.id} />
              <input type="hidden" name="kind" value="collector_nomination" />
              <input
                type="hidden"
                name="reason"
                value="Mời tính tiền từ phần chi phí buổi chơi"
              />
              <label htmlFor="cost-collector">Chọn người khác</label>
              <select
                id="cost-collector"
                name="member_id"
                defaultValue=""
                required
              >
                <option value="" disabled>
                  Chọn người tính tiền
                </option>
                {members
                  .filter(
                    (m) =>
                      m.user_id &&
                      m.id !== s.collector_member_id &&
                      m.id !== s.my_member_id,
                  )
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
              </select>
            </ActionForm>
            <small>
              Người nhận cần có <Link href="/me">ngân hàng trong hồ sơ</Link> và
              tự xác nhận.
            </small>
          </details>
        </div>
      )}
      {s.status === "planned" && request && (
        <div className="collector-pending">
          <p>
            {members.find((m) => m.id === request.payload.member_id)
              ?.display_name || "Thành viên"}{" "}
            được mời tính tiền ·{" "}
            {request.required_authority === s.my_member_id
              ? "Cần bạn xác nhận"
              : `Chờ ${authority?.display_name || "người có quyền"} xác nhận`}
            .
          </p>
          {request.required_authority === s.my_member_id && (
            <div className="actions">
              {["approve", "reject"].map((decision) => (
                <ActionForm
                  key={decision}
                  action={decideApproval}
                  label={
                    decision === "approve"
                      ? "Đồng ý nhận / chuyển vai trò"
                      : "Từ chối"
                  }
                >
                  <input type="hidden" name="id" value={request.id} />
                  <input
                    type="hidden"
                    name="hash"
                    value={request.payload_hash}
                  />
                  <input type="hidden" name="decision" value={decision} />
                </ActionForm>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
