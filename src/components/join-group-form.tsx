"use client";
import { useState } from "react";
import ActionForm from "./action-form";
import { acceptInvite } from "@/app/groups/actions";
export default function JoinGroupForm({
  token,
  sessionId,
  name,
  guests,
}: {
  token: string;
  sessionId: string;
  name: string;
  guests: { id: string; name: string }[];
}) {
  const [claim, setClaim] = useState(false);
  return (
    <ActionForm
      action={acceptInvite}
      label={claim ? "Gửi yêu cầu nhận lại tên cũ" : "Tham gia nhóm"}
    >
      <input type="hidden" name="token" value={token} />
      {sessionId && <input type="hidden" name="session_id" value={sessionId} />}
      {!!guests.length && (
        <fieldset className="join-choices">
          <legend>Bạn đã có tên trong nhóm chưa?</legend>
          <label>
            <input
              type="radio"
              name="join_mode"
              value="new"
              checked={!claim}
              onChange={() => setClaim(false)}
            />{" "}
            Chưa, tôi là thành viên mới
          </label>
          <label>
            <input
              type="radio"
              name="join_mode"
              value="claim"
              checked={claim}
              onChange={() => setClaim(true)}
            />{" "}
            Đã có, tôi muốn nhận lại tên cũ
          </label>
        </fieldset>
      )}
      {claim ? (
        <>
          <input type="hidden" name="name" value={name || "Thành viên"} />
          <label htmlFor="claim-member">Tên của bạn trong nhóm</label>
          <select
            id="claim-member"
            name="claim_member"
            defaultValue=""
            required
          >
            <option value="" disabled>
              Chọn tên được thêm hộ
            </option>
            {guests.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <p>
            Admin xác minh trước khi liên kết. Giữ nguyên lịch sử và các khoản
            tiền.
          </p>
        </>
      ) : (
        <>
          <label htmlFor="name">Tên trong nhóm</label>
          <input
            id="name"
            name="name"
            required
            maxLength={100}
            defaultValue={name}
          />
          {sessionId && (
            <p>Bạn sẽ tự xác nhận tham gia buổi sau khi vào nhóm.</p>
          )}
        </>
      )}
    </ActionForm>
  );
}
