"use client";
import { useState } from "react";
import type { SessionDetail } from "@/lib/session-data";
import { unlockSession } from "@/app/sessions/admin-actions";
import ActionForm from "./action-form";
import AdminReview from "./admin-review";
import ExpenseForm from "./expense-form";
import FinancialChangeForm from "./financial-change-form";
import ExpenseEditButton from "./expense-edit-button";
import type { ExpenseTools } from "@/lib/expense-tools";
type Member = {
  id: string;
  display_name: string;
  user_id: string | null;
  status: string;
};
export default function AdminSessionPanel({
  session: s,
  members,
  requests,
  tools,
}: {
  session: SessionDetail;
  members: Member[];
  requests: { id: string; type: string; created_at: string }[];
  tools?: ExpenseTools;
}) {
  const [source, setSource] = useState("");
  const [reason, setReason] = useState("");
  const [operation, setOperation] = useState("apply_request");
  const [target, setTarget] = useState("");
  const [court, setCourt] = useState("");
  const [checked, setChecked] = useState(false);
  const sourceId = source || null;
  const body =
    operation === "assign_guest_collector"
      ? { member_id: target }
      : operation === "finish_session"
        ? { court }
        : operation === "payment_action"
          ? { target, operation: "confirm", statement_checked: checked }
          : {};
  return (
    <details className="panel">
      <summary>Admin: dự phòng và mở khóa</summary>
      {s.calendar_locked ? (
        <>
          <p>
            Buổi đã khóa sau 30 ngày. Mở khóa có hạn 24 giờ; quyền nhập và xác
            nhận tiền vẫn theo vai trò.
          </p>
          <ActionForm action={unlockSession} label="Mở khóa 24 giờ">
            <input type="hidden" name="sid" value={s.id} />
            <input type="hidden" name="revision" value={s.revision} />
            <label>
              Lý do mở khóa
              <input name="reason" required maxLength={500} />
            </label>
          </ActionForm>
        </>
      ) : (
        <>
          <p>
            Chỉ dùng khi chưa có người tính tiền, người tính tiền chưa có tài
            khoản hoặc yêu cầu gửi đúng người đã quá 72 giờ chưa được xử lý. Mọi
            thao tác có lý do công khai.
          </p>
          <label>
            Yêu cầu làm căn cứ (nếu cần)
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">
                Không chọn — chỉ dùng cho người tính tiền chưa có tài khoản hoặc
                khoản nhận thay đủ điều kiện
              </option>
              {requests.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.type} ·{" "}
                  {new Date(r.created_at).toLocaleDateString("vi-VN")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Thao tác
            <select
              value={operation}
              onChange={(e) => {
                setOperation(e.target.value);
                setTarget("");
                setChecked(false);
              }}
            >
              <option value="apply_request">
                Tạo yêu cầu mới từ yêu cầu hết hạn
              </option>
              <option value="assign_guest_collector">
                Gán người tính tiền chưa có tài khoản
              </option>
              <option value="finish_session">
                Nhập tiền sân và hoàn tất buổi
              </option>
              <option value="payment_action">Xác nhận đã nhận thay</option>
            </select>
          </label>
          {operation === "apply_request" && (
            <p>
              Yêu cầu cũ giữ trạng thái hết hạn. Nội dung được xem lại theo dữ
              liệu hiện tại; người được đề cử vẫn phải tự nhận vai trò.
            </p>
          )}
          {operation === "assign_guest_collector" && (
            <label>
              Thành viên khách đã có ngân hàng
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Chọn thành viên</option>
                {members
                  .filter((m) => !m.user_id && m.status === "active")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {operation === "finish_session" && (
            <label>
              Tiền sân (đ)
              <input
                inputMode="numeric"
                value={court}
                onChange={(e) => setCourt(e.target.value)}
              />
            </label>
          )}
          {operation === "payment_action" && (
            <>
              <label>
                Khoản nhận thay
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Chọn khoản</option>
                  {s.settlements
                    .filter((p) => p.status !== "confirmed")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.from_name} → {p.to_name} · {p.amount}đ
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />{" "}
                Đã đối chiếu đúng số tiền và mã tham chiếu trong sao kê.
              </label>
            </>
          )}
          <label>
            Lý do dự phòng
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </label>
          <AdminReview
            session={s}
            command={operation}
            body={body}
            reason={reason}
            sourceId={sourceId}
            disabled={
              operation === "apply_request"
                ? !sourceId
                : operation === "payment_action"
                  ? !target || !checked
                  : operation === "assign_guest_collector"
                    ? !target
                    : !/^\d+$/.test(court)
            }
          />
          {s.status !== "planned" && s.status !== "cancelled" && (
            <>
              <ExpenseForm
                session={s}
                tools={tools}
                administrative={{ sourceId }}
              />
              {s.expenses.map((e) => (
                <div key={e.id}>
                  <p>{e.title}</p>
                  <ExpenseEditButton id={e.id} administrative={{ sourceId }} />
                </div>
              ))}
              <FinancialChangeForm
                session={s}
                members={members}
                administrative={{ sourceId }}
              />
            </>
          )}
        </>
      )}
    </details>
  );
}
