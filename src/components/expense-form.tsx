"use client";
import { useState } from "react";
import ActionForm from "./action-form";
import { addExpense } from "@/app/sessions/actions";
import type { SessionDetail } from "@/lib/session-data";
import { splitExpense, balances } from "@/lib/expense-calculation";
import { reconcile, formatMoney } from "@/lib/money";
export default function ExpenseForm({
  session: s,
}: {
  session: SessionDetail;
}) {
  const people = s.attendees.filter((m) => m.rsvp === "going" && !m.removed_at);
  const [title, setTitle] = useState(""),
    [amount, setAmount] = useState(""),
    [payer, setPayer] = useState(people[0]?.member_id || ""),
    [mode, setMode] = useState<"total" | "per_person">("total"),
    [split, setSplit] = useState<"equal" | "weighted" | "exact" | "percent">(
      "equal",
    ),
    [selected, setSelected] = useState(people.map((m) => m.member_id)),
    [values, setValues] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(""),
    [review, setReview] = useState(false);
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
  };
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
      ...s.expenses.map((e) => ({
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
      <h2>Thêm phụ phí hoặc giảm giá</h2>
      <div onChange={() => setReview(false)}>
        <label htmlFor="expense-title">Tên khoản chi</label>
        <input
          id="expense-title"
          maxLength={160}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label htmlFor="expense-amount">Số tiền (đ, số âm cho giảm giá)</label>
        <input
          id="expense-amount"
          inputMode="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <label htmlFor="expense-mode">Cách nhập</label>
        <select
          id="expense-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="total">Tổng tiền</option>
          <option value="per_person">Tiền mỗi người</option>
        </select>
        <label htmlFor="expense-payer">Ai ứng?</label>
        <select
          id="expense-payer"
          value={payer}
          onChange={(e) => setPayer(e.target.value)}
        >
          {people.map((m) => (
            <option key={m.member_id} value={m.member_id}>
              {m.name}
            </option>
          ))}
        </select>
        <label htmlFor="expense-split">Cách chia</label>
        <select
          id="expense-split"
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
        <label htmlFor="expense-reason">Lý do thay đổi</label>
        <input
          id="expense-reason"
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
            onClick={() => setReview(true)}
          >
            Tôi đã xem phần chia và công nợ mới
          </button>
          {review && (
            <ActionForm action={addExpense} label="Lưu khoản chi">
              <input
                type="hidden"
                name="payload"
                value={JSON.stringify(payload)}
              />
            </ActionForm>
          )}
        </>
      )}
    </section>
  );
}
