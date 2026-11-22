"use client";
import { useState, useId } from "react";
import ActionForm from "./action-form";
import { addExpense } from "@/app/sessions/actions";
import type { SessionDetail } from "@/lib/session-data";
import { splitExpense, balances } from "@/lib/expense-calculation";
import { reconcile, formatMoney } from "@/lib/money";
import AdminReview from "./admin-review";
import type { ExpenseTools, ExpenseEditor } from "@/lib/expense-tools";
export default function ExpenseForm({
  session: s,
  administrative,
  tools,
  edit,
}: {
  session: SessionDetail;
  administrative?: { sourceId: string | null };
  tools?: ExpenseTools;
  edit?: ExpenseEditor;
}) {
  const prefix = useId();
  const people = s.attendees.filter((m) => m.rsvp === "going" && !m.removed_at);
  const [title, setTitle] = useState(edit?.title || ""),
    [amount, setAmount] = useState(edit?.amount || ""),
    [payer, setPayer] = useState(
      edit?.payer ||
        people.find((m) => m.member_id === s.my_member_id)?.member_id ||
        people[0]?.member_id ||
        "",
    ),
    [mode, setMode] = useState<"total" | "per_person">(edit?.mode || "total"),
    [split, setSplit] = useState<"equal" | "weighted" | "exact" | "percent">(
      edit?.kind === "court" ? "weighted" : edit?.split || "equal",
    ),
    [selected, setSelected] = useState(
      edit?.beneficiaries || people.map((m) => m.member_id),
    ),
    [values, setValues] = useState<Record<string, string>>(
      Object.fromEntries(
        edit?.beneficiaries.map((id, index) => [
          id,
          edit.values[index] || "0",
        ]) || [],
      ),
    ),
    [category, setCategory] = useState(edit?.category_id || ""),
    [note, setNote] = useState(edit?.note || ""),
    [reason, setReason] = useState(""),
    [review, setReview] = useState("");
  let newShares: { memberId: string; amount: bigint }[] = [];
  let transfers: { from: string; to: string; amount: bigint }[] = [];
  let message = "";
  let valid = false;
  const payload = {
    sid: s.id,
    revision: s.revision,
    title,
    amount,
    payer,
    mode,
    split,
    beneficiaries: selected,
    values: selected.map((id) => values[id] || "0"),
    reason,
    expense_id: edit?.id || "",
    category_id: category,
    note,
  };
  const payloadText = JSON.stringify(payload);
  try {
    if (!/^-?\d+$/.test(amount) || !selected.length)
      throw Error("Nhập số tiền và chọn người chịu");
    const extra = splitExpense(
      BigInt(amount),
      mode,
      split,
      selected.map((id) => ({
        id,
        value:
          split === "weighted"
            ? people.find((m) => m.member_id === id)!.weight
            : values[id] || "0",
      })),
      payer,
    );
    const net = balances([
      ...s.expenses
        .filter((e) => e.id !== edit?.id)
        .map((e) => ({
          amount: BigInt(e.amount),
          payer: e.paid_by!,
          shares: e.allocations.map((a) => ({
            memberId: a.member_id,
            amount: BigInt(a.amount),
          })),
        })),
      { amount: extra.amount, payer, shares: extra.shares },
    ]);
    transfers = reconcile(
      net,
      s.settlements
        .filter((p) => p.status === "confirmed")
        .map((p) => ({
          from: p.from_member,
          to: p.to_member,
          amount: BigInt(p.amount),
        })),
      s.collector_member_id!,
    );
    newShares = extra.shares;
    valid = true;
  } catch (error) {
    message = error instanceof Error ? error.message : "Kiểm tra lại bảng chia";
  }
  return (
    <section className="panel">
      <h2>{edit ? "Sửa khoản chi" : "Thêm phụ phí hoặc giảm giá"}</h2>
      {!administrative && s.my_member_id !== s.collector_member_id && (
        <p>
          Khoản chỉ bạn chịu có hiệu lực ngay. Khoản có người khác chịu cần
          người tính tiền duyệt; bảng dưới đây là dự kiến.
        </p>
      )}
      <div onChange={() => setReview("")}>
        {!edit && tools?.templates.some((t) => t.active) && (
          <label>
            Thêm nhanh từ mẫu
            <select
              defaultValue=""
              onChange={(e) => {
                const t = tools.templates.find((t) => t.id === e.target.value);
                if (t) {
                  setTitle(t.title);
                  setAmount(t.amount);
                  setMode(t.mode);
                  setSplit(t.split);
                  setCategory(t.category_id || "");
                  setReview("");
                }
              }}
            >
              <option value="">Chọn mẫu</option>
              {tools.templates
                .filter((t) => t.active)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          Danh mục
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={edit?.kind === "court"}
          >
            <option value="">Không chọn</option>
            {tools?.categories
              .filter((c) => c.active || c.id === category)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Ghi chú
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
          />
        </label>
        <label htmlFor={prefix + "-title"}>Tên khoản chi</label>
        <input
          id={prefix + "-title"}
          maxLength={160}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label htmlFor={prefix + "-amount"}>
          Số tiền (đ, số âm cho giảm giá)
        </label>
        <input
          id={prefix + "-amount"}
          inputMode="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <label htmlFor={prefix + "-mode"}>Cách nhập</label>
        <select
          id={prefix + "-mode"}
          disabled={edit?.kind === "court"}
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="total">Tổng tiền</option>
          <option value="per_person">Tiền mỗi người</option>
        </select>
        <label htmlFor={prefix + "-payer"}>Ai ứng?</label>
        <select
          id={prefix + "-payer"}
          disabled={edit?.kind === "court"}
          value={payer}
          onChange={(e) => setPayer(e.target.value)}
        >
          {edit?.kind === "court" &&
            !people.some((m) => m.member_id === payer) && (
              <option value={payer}>Người tính tiền hiện tại</option>
            )}
          {people.map((m) => (
            <option key={m.member_id} value={m.member_id}>
              {m.name}
            </option>
          ))}
        </select>
        <label htmlFor={prefix + "-split"}>Cách chia</label>
        <select
          id={prefix + "-split"}
          disabled={edit?.kind === "court"}
          value={split}
          onChange={(e) => setSplit(e.target.value as typeof split)}
        >
          <option value="equal">Chia đều</option>
          <option value="weighted">Theo hệ số</option>
          <option value="exact">Số tiền cụ thể</option>
          <option value="percent">Phần trăm</option>
        </select>
        <fieldset>
          <legend>Ai chịu?</legend>
          {people.map((m) => (
            <div key={m.member_id}>
              <label style={{ display: "flex", gap: 10 }}>
                <input
                  style={{ width: 20 }}
                  type="checkbox"
                  disabled={
                    edit?.kind === "court" ||
                    (!!edit &&
                      edit.status === "active" &&
                      !administrative &&
                      s.my_member_id !== s.collector_member_id &&
                      m.member_id !== s.my_member_id)
                  }
                  checked={selected.includes(m.member_id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, m.member_id]
                        : ids.filter((id) => id !== m.member_id),
                    )
                  }
                />
                {m.name}
              </label>
              {selected.includes(m.member_id) &&
                (split === "exact" || split === "percent") && (
                  <input
                    aria-label={`Phần của ${m.name}`}
                    value={values[m.member_id] || ""}
                    inputMode="decimal"
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        [m.member_id]: e.target.value,
                      }))
                    }
                  />
                )}
            </div>
          ))}
        </fieldset>
        <label htmlFor={prefix + "-reason"}>Lý do thay đổi</label>
        <input
          id={prefix + "-reason"}
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="split-preview">
        {valid ? (
          <>
            <h3>Bảng chia khoản mới</h3>
            {newShares.map((a) => (
              <p key={a.memberId}>
                {people.find((m) => m.member_id === a.memberId)?.name}:{" "}
                <strong>{formatMoney(a.amount)}</strong>
              </p>
            ))}
            <h3>Các khoản còn phải chuyển sau thay đổi</h3>
            {transfers.map((p) => (
              <p key={p.from + p.to}>
                {s.attendees.find((m) => m.member_id === p.from)?.name ||
                  "Người tính tiền"}{" "}
                trả{" "}
                {s.attendees.find((m) => m.member_id === p.to)?.name ||
                  "Người tính tiền"}
                : <strong>{formatMoney(p.amount)}</strong>
              </p>
            ))}
            {!transfers.length && <p>Không còn khoản cần chuyển.</p>}
          </>
        ) : (
          <p>{message}</p>
        )}
      </div>
      {valid && title.trim() && reason.trim() && (
        <>
          <button
            className="secondary"
            type="button"
            onClick={() => setReview(payloadText)}
          >
            Tôi đã xem phần chia và công nợ mới
          </button>
          {review === payloadText &&
            (administrative ? (
              <AdminReview
                session={s}
                command="save_expense"
                body={{
                  title_text: title,
                  raw_amount: amount,
                  payer,
                  beneficiaries: selected,
                  mode,
                  split,
                  values_text: selected.map((id) => values[id] || "0"),
                  expense_id: edit?.id || "",
                  category_id: category,
                  note_text: note,
                }}
                reason={reason}
                sourceId={administrative.sourceId}
              />
            ) : (
              <ActionForm action={addExpense} label="Lưu khoản chi">
                <input type="hidden" name="payload" value={payloadText} />
              </ActionForm>
            ))}
        </>
      )}
    </section>
  );
}
