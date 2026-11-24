import type { SessionDetail } from "@/lib/session-data";
import { unlockSession } from "@/app/sessions/admin-actions";
import ActionForm from "./action-form";

export default function AdminSessionPanel({
  session: s,
}: {
  session: SessionDetail;
}) {
  if (!s.calendar_locked) return null;
  return (
    <details className="panel">
      <summary>Admin: mở khóa cập nhật hóa đơn</summary>
      <p>
        Hết thời hạn chỉnh tiền 30 ngày. Mở khóa 24 giờ cho người tính tiền cập
        nhật hóa đơn; lịch và danh sách tham gia vẫn khóa.
      </p>
      <ActionForm action={unlockSession} label="Mở khóa 24 giờ">
        <input type="hidden" name="sid" value={s.id} />
        <input type="hidden" name="revision" value={s.revision} />
        <label>
          Lý do mở khóa
          <input name="reason" required maxLength={500} />
        </label>
      </ActionForm>
    </details>
  );
}
