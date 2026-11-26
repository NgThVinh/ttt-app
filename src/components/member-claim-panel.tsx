import Link from "@/components/app-link";
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
          <p>Chờ admin xác minh trước khi tham gia bằng tên mới.</p>
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
          Đã giữ lịch chơi và các khoản tiền cũ.{" "}
          <Link href="/me">Kiểm tra ngân hàng trong hồ sơ</Link>.
        </p>
      ) : (
        <>
          <p>
            Chọn tên cũ để liên kết với <strong>{email}</strong>. Admin sẽ xác
            minh.
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
