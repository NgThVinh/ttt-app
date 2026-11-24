"use client";
import { useState } from "react";
import ActionForm from "./action-form";
import { sessionCommand } from "@/app/sessions/actions";
import type { SessionDetail } from "@/lib/session-data";
import { allocate, formatMoney } from "@/lib/money";
import { decimalWeight } from "@/lib/expense-calculation";
export default function FinishSessionForm({
  session: s,
}: {
  session: SessionDetail;
}) {
  const [amount, setAmount] = useState(
      s.expenses.find((e) => e.title === "Tiền sân")?.amount || "",
    ),
    [review, setReview] = useState("");
  const reviewKey = `${s.revision}:${amount}`;
  let shares: { memberId: string; amount: bigint }[] = [];
  try {
    if (/^\d+$/.test(amount))
      shares = allocate(
        BigInt(amount),
        s.attendees
          .filter((a) => a.rsvp === "going" && a.committed_at && !a.removed_at)
          .map((a) => ({
            memberId: a.member_id,
            weight: decimalWeight(a.weight),
          })),
        s.collector_member_id!,
      );
  } catch {}
  return (
    <section className="panel">
      <h2>Chốt chi phí buổi chơi</h2>
      <label htmlFor="finish-amount">Tổng tiền sân (đ)</label>
      <input
        id="finish-amount"
        inputMode="numeric"
        pattern="[0-9]+"
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          setReview("");
        }}
      />
      <div className="split-preview">
        {shares.map((a) => (
          <div key={a.memberId}>
            <span>
              {s.attendees.find((m) => m.member_id === a.memberId)?.name}
            </span>
            <strong>{formatMoney(a.amount)}</strong>
          </div>
        ))}
      </div>
      <p>
        Chia cho người đã nhận lời. Chốt chi phí sẽ khóa lịch và việc tham
        gia/rút khỏi buổi.
      </p>
      {shares.length > 0 && (
        <button
          type="button"
          className="secondary"
          onClick={() => setReview(reviewKey)}
        >
          Tôi đã xem bảng chia
        </button>
      )}
      <ActionForm
        action={sessionCommand}
        disabled={review !== reviewKey || !shares.length}
        label="Chốt tiền sân và phát hành khoản thu"
      >
        <input type="hidden" name="sid" value={s.id} />
        <input type="hidden" name="revision" value={s.revision} />
        <input type="hidden" name="operation" value="finish" />
        <input type="hidden" name="court" value={amount} />
        <input
          type="hidden"
          name="reviewed"
          value={review === reviewKey ? "yes" : "no"}
        />
      </ActionForm>
    </section>
  );
}
