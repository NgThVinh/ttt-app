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
            Admin sẽ xác minh trước khi liên kết. Lịch chơi và các khoản tiền cũ
            vẫn được giữ.
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
            <p>Vào nhóm xong, bạn sẽ xem buổi được mời và tự chọn tham gia.</p>
          )}
        </>
      )}
    </ActionForm>
  );
}
