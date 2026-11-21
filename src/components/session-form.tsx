"use client";
import { useState } from "react";
import ActionForm from "./action-form";
import { createSession } from "@/app/sessions/actions";
import { allocate, formatMoney } from "@/lib/money";
export default function SessionForm({
  groups,
  members,
  userId,
}: {
  groups: { id: string; name: string }[];
  members: {
    id: string;
    group_id: string;
    display_name: string;
    user_id: string | null;
  }[];
  userId: string;
}) {
  const [group, setGroup] = useState(groups[0].id),
    [flow, setFlow] = useState("played"),
    [selected, setSelected] = useState<string[]>([]),
    [amount, setAmount] = useState("400000");
  const [review, setReview] = useState(false);
  const inGroup = members.filter((m) => m.group_id === group);
  let preview: { memberId: string; amount: bigint }[] = [];
  try {
    if (selected.length && /^\d+$/.test(amount))
      preview = allocate(
        BigInt(amount),
        selected.map((id) => ({ memberId: id, weight: 1n })),
        inGroup.find((m) => m.user_id === userId)?.id,
      );
  } catch {}
  return (
    <section className="panel">
      <label htmlFor="group">Nhóm</label>
      <select
        id="group"
        value={group}
        onChange={(e) => {
          setGroup(e.target.value);
          setSelected([]);
          setReview(false);
        }}
      >
        {groups.map((g) => (
          <option value={g.id} key={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <label htmlFor="flow">Tạo sau buổi hay hẹn trước?</label>
      <select
        id="flow"
        value={flow}
        onChange={(e) => {
          setFlow(e.target.value);
          setReview(false);
        }}
      >
        <option value="played">Đã chơi — tôi là người tính tiền</option>
        <option value="planned">Hẹn lịch trước</option>
      </select>
      <ActionForm
        action={createSession}
        disabled={flow === "played" && (!review || !preview.length)}
        label={
          review || flow === "planned"
            ? "Lưu buổi chơi"
            : "Xem lại thông tin trước khi lưu"
        }
      >
        <input type="hidden" name="groupId" value={group} />
        <input type="hidden" name="flow" value={flow} />
        <label htmlFor="title">Tên buổi</label>
        <input
          id="title"
          name="title"
          required
          maxLength={160}
          placeholder="Cầu lông tối thứ Năm"
        />
        <label htmlFor="venue">Địa điểm</label>
        <input id="venue" name="venue" required maxLength={200} />
        <label htmlFor="starts">Ngày giờ (Việt Nam)</label>
        <input id="starts" name="starts" type="datetime-local" required />
        {flow === "played" ? (
          <>
            <label htmlFor="court">Tiền sân (đ)</label>
            <input
              id="court"
              name="court"
              inputMode="numeric"
              pattern="[0-9]+"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setReview(false);
              }}
              required
            />
            <fieldset>
              <legend>Ai đã tham gia?</legend>
              {inGroup.map((m) => (
                <label
                  key={m.id}
                  style={{ display: "flex", gap: 10, alignItems: "center" }}
                >
                  <input
                    style={{ width: 20 }}
                    type="checkbox"
                    name="people"
                    value={m.id}
                    checked={selected.includes(m.id)}
                    onChange={(e) => {
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, m.id]
                          : ids.filter((id) => id !== m.id),
                      );
                      setReview(false);
                    }}
                  />
                  {m.display_name}
                </label>
              ))}
            </fieldset>
            <div className="split-preview">
              {preview.map((p) => (
                <div key={p.memberId}>
                  <span>
                    {inGroup.find((m) => m.id === p.memberId)?.display_name}
                  </span>
                  <strong>{formatMoney(p.amount)}</strong>
                </div>
              ))}
            </div>
            <p>
              Phần lẻ dưới 1.000đ sẽ được gán cho người ứng nếu có trong danh
              sách. Bạn sẽ thấy kết quả cuối cùng ở chi tiết buổi.
            </p>
            {!review ? (
              <button
                type="button"
                className="secondary"
                onClick={() => setReview(true)}
              >
                Tôi đã xem bảng chia
              </button>
            ) : (
              <p>Đã xem trước. Lưu để tạo các khoản cần thanh toán.</p>
            )}
            <input
              type="hidden"
              name="reviewed"
              value={review ? "yes" : "no"}
            />
          </>
        ) : (
          <>
            <input type="hidden" name="court" value="0" />
            <label style={{ display: "flex", gap: 10 }}>
              <input
                style={{ width: 20 }}
                type="checkbox"
                name="collector"
                defaultChecked
              />
              Tôi sẽ tính tiền (cần có hồ sơ ngân hàng)
            </label>
            <label htmlFor="commitDeadline">
              Hạn chốt (để trống dùng giờ bắt đầu)
            </label>
            <input
              id="commitDeadline"
              name="commitDeadline"
              type="datetime-local"
            />
            <p>
              Hạn chốt mặc định là giờ bắt đầu. Mỗi người tự chốt đi hay không
              đi.
            </p>
          </>
        )}
      </ActionForm>
    </section>
  );
}
