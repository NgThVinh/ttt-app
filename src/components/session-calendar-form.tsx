"use client";
import { useState } from "react";
import ActionForm from "./action-form";
import { manageSession } from "@/app/sessions/actions";
import type { SessionDetail } from "@/lib/session-data";

function localTime(value: string) {
  return new Date(Date.parse(value) + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}

export default function SessionCalendarForm({
  session: s,
  note,
  canCancel,
  onSaved,
}: {
  session: SessionDetail;
  note: string | null;
  canCancel: boolean;
  onSaved?: () => void;
}) {
  const reopen = s.status === "cancelled";
  const canMove = reopen || s.status === "planned";
  const initialStart = localTime(s.starts_at);
  const initialDeadline = localTime(s.commit_deadline);
  const [starts, setStarts] = useState(initialStart);
  const [ends, setEnds] = useState(s.ends_at ? localTime(s.ends_at) : "");
  const [deadline, setDeadline] = useState(initialDeadline);
  const moved = starts !== initialStart || deadline !== initialDeadline;
  return (
    <div className="session-inline-edit">
      <ActionForm
        action={manageSession}
        onSuccess={onSaved}
        label={
          reopen ? "Mở lại và mời mọi người tự chốt" : "Lưu thông tin buổi"
        }
      >
        <input type="hidden" name="sid" value={s.id} />
        <input type="hidden" name="revision" value={s.revision} />
        <input
          type="hidden"
          name="operation"
          value={reopen ? "reopen" : "edit"}
        />
        <label>
          Tên buổi
          <input name="title" defaultValue={s.title} required maxLength={160} />
        </label>
        <label>
          Địa điểm
          <input name="venue" defaultValue={s.venue} required maxLength={200} />
        </label>
        <label>
          Giờ bắt đầu (giờ Việt Nam)
          <input
            type="datetime-local"
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
            required
            disabled={!canMove}
          />
        </label>
        <input
          type="hidden"
          name="starts_at"
          value={starts === initialStart ? s.starts_at : `${starts}:00+07:00`}
        />
        <label>
          Giờ kết thúc (giờ Việt Nam)
          <input
            type="datetime-local"
            value={ends}
            onChange={(e) => setEnds(e.target.value)}
            disabled={!canMove}
          />
        </label>
        {ends && (
          <input type="hidden" name="ends_at" value={`${ends}:00+07:00`} />
        )}
        <label>
          Nhắc trả lời trước (giờ Việt Nam)
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            required
            disabled={!canMove}
          />
        </label>
        <input
          type="hidden"
          name="commit_deadline"
          value={
            deadline === initialDeadline
              ? s.commit_deadline
              : `${deadline}:00+07:00`
          }
        />
        {!canMove && <p>Lịch đã khóa khi người tính tiền chốt chi phí.</p>}
        <label>
          Ghi chú chung
          <textarea name="note" defaultValue={note || ""} maxLength={2000} />
        </label>
        <label>
          Lý do thay đổi
          <input
            name="reason"
            required
            maxLength={500}
            defaultValue="Cập nhật thông tin buổi"
          />
        </label>
        {(reopen || moved) && (
          <p role="status">
            Mỗi người cần tự chốt lại; lựa chọn cũ được giữ trong lịch sử. Hạn
            chốt mới phải ở tương lai.
          </p>
        )}
      </ActionForm>
      {!reopen &&
        (canCancel ? (
          <details style={{ marginTop: 24 }}>
            <summary>Hủy buổi này</summary>
            <p>
              Buổi được giữ trong lịch sử. Các yêu cầu đang chờ sẽ được hủy.
              Muốn mở lại, hãy đặt hạn chốt mới trong tương lai.
            </p>
            <ActionForm action={manageSession} label="Xác nhận hủy buổi">
              <input type="hidden" name="sid" value={s.id} />
              <input type="hidden" name="revision" value={s.revision} />
              <input type="hidden" name="operation" value="cancel" />
              <label>
                Lý do hủy
                <input name="reason" required maxLength={500} />
              </label>
              <label>
                <input type="checkbox" name="reviewed" value="yes" required />{" "}
                Tôi muốn hủy riêng buổi này.
              </label>
            </ActionForm>
          </details>
        ) : (
          <p>
            Buổi đã có số tiền hoặc lịch sử thanh toán. Người tính tiền cần xử
            lý các khoản bằng điều chỉnh.
          </p>
        ))}
    </div>
  );
}
