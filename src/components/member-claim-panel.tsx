import Link from "next/link";
import ActionForm from "./action-form";
import { requestClaim, cancelClaim } from "@/app/groups/actions";
export type MemberClaim = {
  id: string;
  status: string;
  expires_at: string;
  payload: { member_id?: string };
};
export default function MemberClaimPanel({
  email,
  guests,
  claims,
  admin,
  now,
}: {
  email?: string;
  guests: { id: string; display_name: string }[];
  claims: MemberClaim[];
  admin: boolean;
  now: number;
}) {
  const latest = claims[0];
  const pending =
    latest?.status === "pending" && Date.parse(latest.expires_at) > now;
  const approved = latest?.status === "approved";
  if (admin || (!guests.length && !latest)) return null;
  const target = guests.find((g) => g.id === latest?.payload.member_id);
  return (
    <section
      className="panel claim-panel"
      id="link-account"
      aria-labelledby="claim-title"
    >
      <h2 id="claim-title">
        {pending
          ? "Chờ admin liên kết tài khoản"
          : approved
            ? "Đã liên kết với tên cũ"
            : "Bạn đã có tên trong nhóm?"}
      </h2>
      {pending ? (
        <div className="claim-status" role="status">
          <p>
            Đã yêu cầu nhận lại{" "}
            <strong>{target?.display_name || "tên cũ"}</strong> bằng email{" "}
            <strong>{email}</strong>.
          </p>
          <p>
            Admin cần xác minh đúng người. Trong lúc chờ, hãy tránh tham gia
            buổi bằng tên mới để giữ lịch sử liền mạch.
          </p>
          <small>
            Hạn xác minh:{" "}
            {new Date(latest.expires_at).toLocaleString("vi-VN", {
              timeZone: "Asia/Ho_Chi_Minh",
            })}
            .
          </small>
          <ActionForm action={cancelClaim} label="Hủy yêu cầu liên kết">
            <input type="hidden" name="id" value={latest.id} />
          </ActionForm>
        </div>
      ) : approved ? (
        <p role="status">
          Tên cũ, lịch chơi và các khoản tiền đã thuộc tài khoản này.{" "}
          <Link href="/me">Kiểm tra ngân hàng trong hồ sơ</Link>.
        </p>
      ) : (
        <>
          <p>
            Nếu bạn bè đã thêm tên bạn để chia tiền, hãy chọn tên đó để liên kết
            với <strong>{email}</strong>. Admin sẽ xác minh; lịch sử cũ được giữ
            nguyên.
          </p>
          {latest && (
            <p role="status">
              {latest.status === "rejected"
                ? "Admin đã từ chối yêu cầu trước. Kiểm tra lại tên hoặc liên hệ admin."
                : "Yêu cầu trước không còn hiệu lực. Bạn có thể gửi lại."}
            </p>
          )}
          {!!guests.length && (
            <ActionForm
              action={requestClaim}
              label="Yêu cầu liên kết tài khoản"
            >
              <label htmlFor="existing-member">
                Tên được thêm hộ trong nhóm
              </label>
              <select
                id="existing-member"
                name="target"
                defaultValue=""
                required
              >
                <option value="" disabled>
                  Chọn tên của bạn
                </option>
                {guests.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.display_name}
                  </option>
                ))}
              </select>
            </ActionForm>
          )}
        </>
      )}
    </section>
  );
}
