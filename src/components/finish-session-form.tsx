"use client";
import { useState } from "react";
import ActionForm from "./action-form";
import { sessionCommand } from "@/app/sessions/actions";
import type { SessionDetail } from "@/lib/session-data";
import type { ExpenseTools } from "@/lib/expense-tools";
import { formatMoney } from "@/lib/money";
import { courtInputSchema } from "@/lib/number-input";
import { splitExpense } from "@/lib/expense-calculation";
import { finishExtrasSchema } from "@/lib/session-costs";
type Extra = {
  key: string;
  title: string;
  amount: string;
  payer: string;
  mode: "total" | "per_person";
  split: "equal" | "weighted" | "exact" | "percent";
  beneficiaries: string[];
  values: Record<string, string>;
  category_id: string;
  note: string;
};
export default function FinishSessionForm({
  session: s,
  tools,
}: {
  session: SessionDetail;
  tools?: ExpenseTools;
}) {
  const people = s.attendees.filter(
    (a) => a.rsvp === "going" && a.committed_at && !a.removed_at,
  );
  const [court, setCourt] = useState(
    s.expenses.find((e) => e.title === "Tiền sân")?.amount || "",
  );
  const [extras, setExtras] = useState<Extra[]>([]),
    [review, setReview] = useState("");
  const payload = extras.map((e) => ({
    ...e,
    values: e.beneficiaries.map((id) => e.values[id] || "0"),
    reason: "Chốt chi phí buổi chơi",
    expense_id: "",
  }));
  const fingerprint = JSON.stringify([s.revision, court, payload]);
  function change(key: string, patch: Partial<Extra>) {
    setExtras((rows) =>
      rows.map((e) => (e.key === key ? { ...e, ...patch } : e)),
    );
  }
  function add(template?: NonNullable<ExpenseTools>["templates"][number]) {
    setExtras((rows) => [
      ...rows,
      {
        key: crypto.randomUUID(),
        title: template?.title || "",
        amount: template?.amount || "",
        payer: people.some((p) => p.member_id === s.my_member_id)
          ? s.my_member_id
          : people[0]?.member_id || "",
        mode: template?.mode || "total",
        split: template?.split || "equal",
        beneficiaries: people.map((p) => p.member_id),
        values: {},
        category_id: template?.category_id || "",
        note: "",
      },
    ]);
  }
  let error = "",
    total = 0n;
  const shares: Record<string, bigint> = {};
  try {
    if (!courtInputSchema.safeParse(court).success)
      throw Error("Nhập tiền sân hợp lệ (có thể bằng 0).");
    if (!people.length) throw Error("Cần ít nhất một người đã nhận lời.");
    const checked = finishExtrasSchema.safeParse(payload);
    if (!checked.success)
      throw Error("Điền tên, số tiền và người chịu cho từng phụ phí.");
    const rows = [
      splitExpense(
        BigInt(courtInputSchema.parse(court)),
        "total",
        "weighted",
        people.map((p) => ({ id: p.member_id, value: p.weight })),
        s.collector_member_id!,
      ),
    ];
    checked.data.forEach((e) => {
      if (
        !e.beneficiaries.length ||
        !people.some((p) => p.member_id === e.payer)
      )
        throw Error("Chọn người ứng và người chịu cho phụ phí.");
      rows.push(
        splitExpense(
          BigInt(e.amount),
          e.mode,
          e.split,
          e.beneficiaries.map((id, index) => ({
            id,
            value:
              e.split === "weighted"
                ? people.find((p) => p.member_id === id)!.weight
                : e.values[index] || "0",
          })),
          e.payer,
        ),
      );
    });
    rows.push(
      ...s.expenses
        .filter((e) => (e.kind ? e.kind !== "court" : e.title !== "Tiền sân"))
        .map((e) => ({
          amount: BigInt(e.amount),
          shares: e.allocations.map((a) => ({
            memberId: a.member_id,
            amount: BigInt(a.amount),
          })),
        })),
    );
    for (const row of rows) {
      total += row.amount;
      for (const a of row.shares)
        shares[a.memberId] = (shares[a.memberId] || 0n) + a.amount;
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Kiểm tra bảng chi phí.";
  }
  const grouped = new Map<string, { amount: bigint; names: string[] }>();
  for (const p of people) {
    const amount = shares[p.member_id] || 0n,
      key = amount.toString();
    const row = grouped.get(key) || { amount, names: [] };
    row.names.push(p.name);
    grouped.set(key, row);
  }
  return (
    <div className="cost-composer">
      <div className="cost-court">
        <label htmlFor="finish-amount">Tiền sân (đ)</label>
        <input
          id="finish-amount"
          inputMode="numeric"
          value={court}
          onChange={(e) => setCourt(e.target.value)}
          placeholder="0"
        />
      </div>
      {!!extras.length && (
        <p className="field-hint">Dùng số âm cho khoản giảm giá.</p>
      )}
      {extras.map((e, index) => (
        <fieldset className="cost-extra" key={e.key}>
          <legend>Phụ phí {index + 1}</legend>
          <div className="cost-extra-main">
            <label>
              Tên khoản phí
              <input
                value={e.title}
                maxLength={160}
                onChange={(x) => change(e.key, { title: x.target.value })}
                placeholder="Nước, cầu, gửi xe…"
              />
            </label>
            <label>
              Số tiền (đ)
              <input
                inputMode="numeric"
                value={e.amount}
                onChange={(x) => change(e.key, { amount: x.target.value })}
                placeholder="0"
              />
            </label>
            <button
              className="secondary cost-remove"
              type="button"
              aria-label={`Xóa phụ phí ${index + 1}`}
              onClick={() =>
                setExtras((rows) => rows.filter((r) => r.key !== e.key))
              }
            >
              Xóa
            </button>
          </div>
          <details>
            <summary>Người ứng, người chịu và cách chia</summary>
            <div className="compact-fields">
              <label>
                Người ứng
                <select
                  aria-label="Người ứng"
                  value={e.payer}
                  onChange={(x) => change(e.key, { payer: x.target.value })}
                >
                  {people.map((p) => (
                    <option key={p.member_id} value={p.member_id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Loại số tiền
                <select
                  aria-label="Loại số tiền"
                  value={e.mode}
                  onChange={(x) =>
                    change(e.key, { mode: x.target.value as Extra["mode"] })
                  }
                >
                  <option value="total">Tổng khoản</option>
                  <option value="per_person">Mỗi người</option>
                </select>
              </label>
              <label>
                Cách chia
                <select
                  aria-label="Cách chia"
                  value={e.split}
                  onChange={(x) =>
                    change(e.key, { split: x.target.value as Extra["split"] })
                  }
                >
                  <option value="equal">Chia đều</option>
                  <option value="weighted">Theo hệ số</option>
                  <option value="exact">Số tiền cụ thể</option>
                  <option value="percent">Theo phần trăm</option>
                </select>
              </label>
            </div>
            <fieldset className="cost-beneficiaries">
              <legend>Người chịu</legend>
              {people.map((p) => (
                <div key={p.member_id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={e.beneficiaries.includes(p.member_id)}
                      onChange={(x) =>
                        change(e.key, {
                          beneficiaries: x.target.checked
                            ? [...e.beneficiaries, p.member_id]
                            : e.beneficiaries.filter(
                                (id) => id !== p.member_id,
                              ),
                        })
                      }
                    />
                    {p.name}
                  </label>
                  {(e.split === "exact" || e.split === "percent") &&
                    e.beneficiaries.includes(p.member_id) && (
                      <input
                        aria-label={`${e.split === "percent" ? "Phần trăm" : "Phần tiền"} của ${p.name}`}
                        inputMode="decimal"
                        value={e.values[p.member_id] || ""}
                        onChange={(x) =>
                          change(e.key, {
                            values: {
                              ...e.values,
                              [p.member_id]: x.target.value,
                            },
                          })
                        }
                      />
                    )}
                </div>
              ))}
            </fieldset>
            {tools && (
              <label>
                Danh mục
                <select
                  value={e.category_id}
                  onChange={(x) =>
                    change(e.key, { category_id: x.target.value })
                  }
                >
                  <option value="">Phụ phí</option>
                  {tools.categories
                    .filter((c) => c.active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Ghi chú
              <input
                value={e.note}
                maxLength={2000}
                onChange={(x) => change(e.key, { note: x.target.value })}
              />
            </label>
          </details>
        </fieldset>
      ))}
      <div className="cost-add">
        <button
          className="secondary"
          type="button"
          onClick={() => add()}
          disabled={extras.length >= 199}
        >
          + Thêm phụ phí
        </button>
        {!!tools?.templates.some((t) => t.active) && (
          <select
            aria-label="Thêm từ mẫu phụ phí"
            value=""
            onChange={(e) => {
              const t = tools?.templates.find((t) => t.id === e.target.value);
              if (t) add(t);
            }}
          >
            <option value="">Thêm từ mẫu…</option>
            {tools.templates
              .filter((t) => t.active)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        )}
      </div>
      {error ? (
        <p className="field-hint" role={court ? "alert" : undefined}>
          {court ? error : "Nhập tiền sân để xem phần chia."}
        </p>
      ) : (
        <>
          <div className="section-heading cost-total">
            <strong>Tổng chi phí</strong>
            <strong>{formatMoney(total)}</strong>
          </div>
          <p className="field-hint">Phần chi phí mỗi người</p>
          <div className="split-preview" aria-label="Xem trước toàn bộ chi phí">
            {[...grouped].map(([key, row]) => (
              <div key={key} className="split-group">
                <span>{row.names.join(", ")}</span>
                <strong>
                  {formatMoney(row.amount)}
                  <small>/người</small>
                </strong>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="field-hint">Chốt sẽ khóa lịch và danh sách tham gia.</p>
      <div className="cost-submit-actions">
        {!error && (
          <button
            type="button"
            className="secondary"
            aria-pressed={review === fingerprint}
            onClick={() => setReview(fingerprint)}
          >
            Tôi đã xem bảng chia
          </button>
        )}
        <ActionForm
          action={sessionCommand}
          label="Chốt toàn bộ chi phí"
          disabled={!!error || review !== fingerprint}
        >
          <input type="hidden" name="sid" value={s.id} />
          <input type="hidden" name="revision" value={s.revision} />
          <input type="hidden" name="operation" value="finish" />
          <input type="hidden" name="court" value={court} />
          <input type="hidden" name="extras" value={JSON.stringify(payload)} />
          <input
            type="hidden"
            name="reviewed"
            value={review === fingerprint ? "yes" : "no"}
          />
        </ActionForm>
      </div>
    </div>
  );
}
