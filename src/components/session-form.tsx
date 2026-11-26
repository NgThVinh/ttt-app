"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ActionForm from "./action-form";
import { createSession } from "@/app/sessions/actions";
import { formatMoney, reconcile } from "@/lib/money";
import { splitExpense, balances } from "@/lib/expense-calculation";
import type { ExpenseTools } from "@/lib/expense-tools";
import DateTimeField from "./ui/date-time-field";
import { Table, TableHead, TableCell } from "./ui/table";
import SuggestedSessionDetails, {
  type SessionSuggestion,
} from "./suggested-session-details";
import MeetingForm, { type MeetingEvent } from "./meeting-form";
import {
  courtInputSchema,
  formatVndInput,
  vndInputSchema,
  weightInputSchema,
} from "@/lib/number-input";
type Extra = {
  title: string;
  amount: string;
  mode: "total" | "per_person";
  split: "equal" | "weighted";
  payer: string;
  beneficiaries: string[] | null;
  category_id: string;
  note: string;
};
export default function SessionForm({
  groups,
  members,
  userId,
  toolsByGroup,
  initialTime,
  suggestions = {},
  bankReady = true,
  events = [],
  initialDate,
}: {
  groups: { id: string; name: string }[];
  members: {
    id: string;
    group_id: string;
    display_name: string;
    user_id: string | null;
  }[];
  userId: string;
  toolsByGroup: Record<string, ExpenseTools>;
  initialTime: string;
  suggestions?: Record<string, SessionSuggestion>;
  bankReady?: boolean;
  events?: MeetingEvent[];
  initialDate?: string;
}) {
  const [group, setGroup] = useState(groups[0].id),
    [flow, setFlow] = useState(
      initialDate &&
        initialDate <
          new Date(Date.parse(initialTime) + 7 * 3600000)
            .toISOString()
            .slice(0, 10)
        ? "played"
        : "planned",
    ),
    [selected, setSelected] = useState<string[]>([]),
    [amount, setAmount] = useState("");
  const fieldId = useId();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [courtTouched, setCourtTouched] = useState(false);
  const [weights, setWeights] = useState<Record<string, string>>({}),
    [extras, setExtras] = useState<Extra[]>([]),
    [review, setReview] = useState(""),
    [collectorMode, setCollectorMode] = useState("self");
  const needsBank =
    !bankReady && (flow === "played" || collectorMode === "self");
  const inGroup = members.filter((m) => m.group_id === group),
    actor = inGroup.find((m) => m.user_id === userId)?.id || "",
    tools = toolsByGroup[group];
  const defaultTime = (offset: number) =>
    new Date(new Date(initialTime).getTime() + 7 * 3600000 + offset)
      .toISOString()
      .slice(0, 16);
  const [starts, setStarts] = useState(
    initialDate ? initialDate + "T18:00" : defaultTime(0),
  );
  const courtInput = courtInputSchema.safeParse(amount);
  const weightInputs = Object.fromEntries(
    selected.map((id) => [id, weightInputSchema.safeParse(weights[id] ?? "1")]),
  );
  const weightMap = Object.fromEntries(
    selected.map((id) => [
      id,
      weightInputs[id].success ? weightInputs[id].data : (weights[id] ?? "1"),
    ]),
  );
  const extraInputs = extras.map((e) => vndInputSchema.safeParse(e.amount));
  const courtError = courtInput.success
    ? ""
    : courtInput.error.issues[0].message;
  const payloadExtras = extras.map((e, index) => ({
    ...e,
    amount: extraInputs[index].success ? extraInputs[index].data : e.amount,
    beneficiaries: e.beneficiaries ?? selected,
    values: [],
    reason: "Tạo buổi đã chơi",
  }));
  const fingerprint = JSON.stringify({
    group,
    selected,
    amount: courtInput.success ? courtInput.data : amount,
    weightMap,
    payloadExtras,
  });
  let shares: { memberId: string; amount: bigint }[] = [],
    transfers: { from: string; to: string; amount: bigint }[] = [],
    error = "";
  try {
    if (!courtInput.success) throw Error(courtError);
    if (!selected.length) throw Error("Chọn ít nhất một người đã tham gia.");
    const people = selected.map((id) => {
      const value = weightMap[id];
      const parsed = weightInputs[id];
      if (!parsed.success) throw Error(parsed.error.issues[0].message);
      return { id, value };
    });
    const court = splitExpense(
      BigInt(courtInput.data),
      "total",
      "weighted",
      people,
      actor,
    );
    const costs = [{ ...court, payer: actor }];
    for (const [index, e] of payloadExtras.entries()) {
      const extraInput = extraInputs[index];
      if (!extraInput.success)
        throw Error(
          `Khoản ${index + 1}: ${extraInput.error.issues[0].message}`,
        );
      if (
        !e.title.trim() ||
        !inGroup.some((m) => m.id === e.payer) ||
        !e.beneficiaries.length ||
        e.beneficiaries.some((id) => !selected.includes(id)) ||
        !/^-?\d+$/.test(e.amount) ||
        BigInt(e.amount) > 1000000000000n ||
        BigInt(e.amount) < -1000000000000n
      )
        throw Error(
          "Kiểm tra tên, số tiền, người ứng và người chịu của phụ phí.",
        );
      costs.push({
        ...splitExpense(
          BigInt(e.amount),
          e.mode,
          e.split,
          e.beneficiaries.map((id) => ({ id, value: weightMap[id] })),
          e.payer,
        ),
        payer: e.payer,
      });
    }
    shares = selected.map((memberId) => ({
      memberId,
      amount: costs.reduce(
        (sum, c) =>
          sum + (c.shares.find((p) => p.memberId === memberId)?.amount || 0n),
        0n,
      ),
    }));
    transfers = reconcile(balances(costs), [], actor);
  } catch (e) {
    error = e instanceof Error ? e.message : "Kiểm tra bảng chia.";
  }
  const reviewed = review === fingerprint && !error;
  function addExtra(template?: ExpenseTools["templates"][number]) {
    setExtras((old) => [
      ...old,
      {
        title: template?.title || "",
        amount: template?.amount || "10000",
        mode: template?.mode || "total",
        split: template?.split || "equal",
        payer: actor,
        beneficiaries: null,
        category_id: template?.category_id || "",
        note: "",
      },
    ]);
  }
  function updateExtra(index: number, patch: Partial<Extra>) {
    setExtras((old) =>
      old.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    );
  }
  const name = (id: string) =>
    inGroup.find((m) => m.id === id)?.display_name || "Thành viên";
  if (flow === "planned")
    return (
      <>
        {
          <div className="meeting-mode" role="group" aria-label="Loại buổi">
            <button type="button" aria-pressed={true}>
              Đặt lịch
            </button>
            <button
              type="button"
              className="secondary"
              aria-pressed={false}
              onClick={() => setFlow("played")}
            >
              Nhập buổi đã chơi
            </button>
          </div>
        }
        <MeetingForm
          initialDate={initialDate}
          groups={groups}
          members={members}
          initialTime={initialTime}
          suggestions={suggestions}
          bankReady={bankReady}
          events={events}
        />
      </>
    );
  return (
    <section className="panel session-form">
      {needsBank && (
        <aside className="bank-setup-notice" role="alert">
          <strong>Chưa thể lưu buổi khi bạn nhận tính tiền</strong>
          <p>
            Bạn cần bổ sung ngân hàng, số tài khoản và tên chủ tài khoản. Các
            thông tin đã nhập trong form vẫn được giữ.
          </p>
          <Link href="/me" target="_blank" rel="noopener noreferrer">
            Bổ sung ngân hàng (tab mới)
          </Link>{" "}
          <button
            type="button"
            className="secondary"
            onClick={() => router.refresh()}
          >
            Đã cập nhật · Kiểm tra lại
          </button>
        </aside>
      )}
      {flow === "played" && (
        <>
          <nav className="form-steps" aria-label="Các phần tạo buổi">
            {["Lịch & tiền", "Người chơi", "Xem lại"].map((label, index) => (
              <button
                type="button"
                key={label}
                aria-current={step === index ? "step" : undefined}
                onClick={() => setStep(index)}
              >
                {index + 1}. {label}
              </button>
            ))}
          </nav>
          <p className="form-overview">
            {courtInput.success
              ? formatMoney(BigInt(courtInput.data))
              : "Chưa nhập tiền sân"}{" "}
            · {selected.length} người ·{" "}
            {extras.length ? `${extras.length} phụ phí` : "Chia đều mặc định"}
          </p>
        </>
      )}
      <div className="compact-fields" hidden={flow === "played" && step !== 0}>
        <label>
          Nhóm
          <select
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              setSelected([]);
              setWeights({});
              setExtras([]);
            }}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Loại buổi
          <select
            value={flow}
            onChange={(e) => {
              setFlow(e.target.value);
              setStarts(
                defaultTime(e.target.value === "planned" ? 86400000 : 0),
              );
            }}
          >
            <option value="played">Đã chơi — tôi tính tiền</option>
            <option value="planned">Đã có lịch — mời mọi người tham gia</option>
          </select>
        </label>
      </div>
      <ActionForm
        action={createSession}
        preserveValues
        hideSubmit={flow === "played" && step !== 2}
        onInvalidCapture={(event) => {
          const target = event.target as HTMLElement;
          const details = target.closest("details");
          if (details) details.open = true;
          setStep(target.closest(".split-customization") ? 1 : 0);
        }}
        disabled={needsBank || (flow === "played" && !reviewed)}
        disabledReason={
          needsBank
            ? "Chưa lưu: bổ sung thông tin ngân hàng rồi bấm Kiểm tra lại."
            : flow === "played" && !reviewed
              ? error ||
                "Xem bảng chia và bấm “Tôi đã xem bảng chia” trước khi lưu."
              : undefined
        }
        label="Lưu buổi chơi"
      >
        <input type="hidden" name="groupId" value={group} />
        <input type="hidden" name="flow" value={flow} />
        <input
          type="hidden"
          name="weights"
          value={JSON.stringify(flow === "played" ? weightMap : {})}
        />
        <input
          type="hidden"
          name="extras"
          value={JSON.stringify(flow === "played" ? payloadExtras : [])}
        />
        <div hidden={flow === "played" && step !== 0}>
          <SuggestedSessionDetails
            key={group}
            groupName={groups.find((g) => g.id === group)?.name || "cùng nhóm"}
            date={starts}
            suggestion={suggestions[group]}
          />
          <DateTimeField
            id={`${fieldId}-starts`}
            name="starts"
            label="Ngày giờ (Việt Nam)"
            required
            value={starts}
            onChange={setStarts}
          />
        </div>
        {flow === "played" ? (
          <>
            <input type="hidden" name="collectorMode" value="self" />
            <label hidden={step !== 0}>
              Tiền sân (đ)
              <input
                name="court"
                inputMode="numeric"
                required
                value={amount}
                placeholder="Ví dụ: 400.000"
                aria-invalid={!!courtError && courtTouched}
                aria-describedby={`${fieldId}-court-help`}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={() => {
                  setCourtTouched(true);
                  setAmount(formatVndInput(amount));
                }}
              />
            </label>
            <p
              hidden={step !== 0}
              id={`${fieldId}-court-help`}
              className={
                courtError && (courtTouched || amount)
                  ? "field-error"
                  : "field-hint"
              }
            >
              {courtError && (courtTouched || amount)
                ? courtError
                : "Nhập giá sân thực tế. Có thể dùng 400000, 400.000 hoặc 400,000."}
            </p>
            <fieldset hidden={step !== 1}>
              <legend>Ai đã tham gia?</legend>
              {!selected.length && (
                <p className="field-hint">
                  Chọn ít nhất một người đã tham gia.
                </p>
              )}
              <button
                type="button"
                className="secondary"
                onClick={() => setSelected(inGroup.map((m) => m.id))}
              >
                Chọn tất cả
              </button>{" "}
              <button
                type="button"
                className="secondary"
                onClick={() => setSelected([])}
              >
                Bỏ chọn
              </button>
              <p className="field-hint">
                Đã chọn {selected.length}/{inGroup.length} người
              </p>
              <div className="participant-list">
                {inGroup.map((m) => (
                  <div key={m.id} className="member-choice">
                    <label>
                      <input
                        type="checkbox"
                        name="people"
                        value={m.id}
                        checked={selected.includes(m.id)}
                        onChange={(e) =>
                          setSelected((old) =>
                            e.target.checked
                              ? [...old, m.id]
                              : old.filter((id) => id !== m.id),
                          )
                        }
                      />
                      {m.display_name}
                    </label>
                  </div>
                ))}
              </div>
            </fieldset>
            <p hidden={step !== 1}>
              {selected.some((id) => weightMap[id] !== "1")
                ? "Đang chia tiền sân theo hệ số đã tùy chỉnh."
                : "Chia đều tiền sân cho những người đã chọn."}
            </p>
            <details className="split-customization" hidden={step !== 1}>
              <summary>
                Tùy chỉnh cách chia và phụ phí
                {extras.length > 0 ||
                selected.some((id) => weightMap[id] !== "1")
                  ? " · Đã tùy chỉnh"
                  : ""}
              </summary>
              <fieldset>
                <legend>Hệ số tham gia</legend>
                <p className="field-hint">
                  1 = cả buổi · 0,5 = nửa buổi. Để 1 nếu chia đều.
                </p>
                {selected.map((id) => (
                  <div key={id}>
                    <label>
                      Hệ số của {name(id)}
                      <input
                        inputMode="decimal"
                        value={weights[id] ?? "1"}
                        aria-invalid={!weightInputs[id].success}
                        aria-describedby={
                          !weightInputs[id].success
                            ? `${fieldId}-weight-${id}`
                            : undefined
                        }
                        onChange={(e) =>
                          setWeights((old) => ({
                            ...old,
                            [id]: e.target.value,
                          }))
                        }
                      />
                    </label>
                    {!weightInputs[id].success && (
                      <p id={`${fieldId}-weight-${id}`} className="field-error">
                        {weightInputs[id].error.issues[0].message}
                      </p>
                    )}
                  </div>
                ))}
              </fieldset>
              <h2>Phụ phí và giảm giá</h2>
              <p>
                Thêm cùng buổi, xem toàn bộ phần chia trước khi lưu. Số âm dùng
                cho giảm giá.
              </p>
              {extras.length < 199 && (
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => addExtra()}
                  >
                    Thêm khoản chi
                  </button>
                  {tools?.templates
                    .filter((t) => t.active)
                    .map((t) => (
                      <button
                        type="button"
                        className="secondary"
                        key={t.id}
                        onClick={() => addExtra(t)}
                      >
                        + {t.title}
                      </button>
                    ))}
                </div>
              )}
              {extras.map((e, i) => (
                <fieldset key={i}>
                  <legend>Khoản {i + 1}</legend>
                  <label>
                    Tên khoản
                    <input
                      required
                      maxLength={160}
                      value={e.title}
                      onChange={(v) =>
                        updateExtra(i, { title: v.target.value })
                      }
                    />
                  </label>
                  <label>
                    Số tiền (đ)
                    <input
                      required
                      inputMode="numeric"
                      value={e.amount}
                      aria-invalid={!extraInputs[i].success}
                      aria-describedby={
                        !extraInputs[i].success
                          ? `${fieldId}-extra-${i}`
                          : undefined
                      }
                      onChange={(v) =>
                        updateExtra(i, { amount: v.target.value })
                      }
                      onBlur={() =>
                        updateExtra(i, { amount: formatVndInput(e.amount) })
                      }
                    />
                  </label>
                  {!extraInputs[i].success && (
                    <p id={`${fieldId}-extra-${i}`} className="field-error">
                      {extraInputs[i].error.issues[0].message}
                    </p>
                  )}
                  <label>
                    Loại số tiền
                    <select
                      value={e.mode}
                      onChange={(v) =>
                        updateExtra(i, {
                          mode: v.target.value as Extra["mode"],
                        })
                      }
                    >
                      <option value="total">Tổng khoản</option>
                      <option value="per_person">Đơn giá mỗi người</option>
                    </select>
                  </label>
                  <label>
                    Cách chia
                    <select
                      value={e.split}
                      onChange={(v) =>
                        updateExtra(i, {
                          split: v.target.value as Extra["split"],
                        })
                      }
                    >
                      <option value="equal">Chia đều</option>
                      <option value="weighted">Theo hệ số tham gia</option>
                    </select>
                  </label>
                  <label>
                    Người ứng
                    <select
                      value={e.payer}
                      onChange={(v) =>
                        updateExtra(i, { payer: v.target.value })
                      }
                    >
                      {inGroup.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Người chịu
                    <select
                      value={e.beneficiaries === null ? "all" : "custom"}
                      onChange={(v) =>
                        updateExtra(i, {
                          beneficiaries:
                            v.target.value === "all" ? null : [...selected],
                        })
                      }
                    >
                      <option value="all">Tất cả người tham gia</option>
                      <option value="custom">Chọn riêng</option>
                    </select>
                  </label>
                  {e.beneficiaries !== null &&
                    selected.map((id) => (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked={e.beneficiaries!.includes(id)}
                          onChange={(v) =>
                            updateExtra(i, {
                              beneficiaries: v.target.checked
                                ? [...e.beneficiaries!, id]
                                : e.beneficiaries!.filter((p) => p !== id),
                            })
                          }
                        />
                        {name(id)}
                      </label>
                    ))}
                  <label>
                    Danh mục
                    <select
                      value={e.category_id}
                      onChange={(v) =>
                        updateExtra(i, { category_id: v.target.value })
                      }
                    >
                      <option value="">Khác</option>
                      {tools?.categories
                        .filter((c) => c.active)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Ghi chú
                    <input
                      maxLength={2000}
                      value={e.note}
                      onChange={(v) => updateExtra(i, { note: v.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      setExtras((old) => old.filter((_, n) => n !== i))
                    }
                  >
                    Bỏ khoản {i + 1}
                  </button>
                </fieldset>
              ))}
            </details>
            <div hidden={step !== 2}>
              <h2>Xem trước tổng phần chịu</h2>
              {error ? (
                <p role="status">{error}</p>
              ) : (
                <>
                  <Table aria-label="Bảng chia tiền xem trước">
                    <caption>Phần mỗi người chịu</caption>
                    <thead>
                      <tr>
                        <TableHead>Người chơi</TableHead>
                        <TableHead className="money">Số tiền</TableHead>
                      </tr>
                    </thead>
                    <tbody className="split-preview">
                      {shares.map((p) => (
                        <tr key={p.memberId}>
                          <TableCell>{name(p.memberId)}</TableCell>
                          <TableCell className="money">
                            <strong>{formatMoney(p.amount)}</strong>
                          </TableCell>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <h3>Cần thanh toán</h3>
                  {transfers.length ? (
                    transfers.map((t) => (
                      <p key={t.from + t.to}>
                        {name(t.from)} → {name(t.to)}:{" "}
                        <strong>{formatMoney(t.amount)}</strong>
                      </p>
                    ))
                  ) : (
                    <p>Không có khoản cần chuyển.</p>
                  )}
                  <details>
                    <summary>Cách làm tròn</summary>{" "}
                    <p>
                      Phần lẻ dưới 1.000đ thuộc người ứng nếu cùng chịu khoản
                      chi; nếu không, thuộc người có phần lý thuyết lớn nhất.
                    </p>
                  </details>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setReview(fingerprint)}
                  >
                    Tôi đã xem bảng chia
                  </button>
                </>
              )}
              <input
                type="hidden"
                name="reviewed"
                value={reviewed ? "yes" : "no"}
              />
              {reviewed && <p role="status">Đã xem trước. Có thể lưu buổi.</p>}
            </div>
          </>
        ) : (
          <>
            <input type="hidden" name="court" value="0" />
            <label>
              Người tính tiền
              <select
                name="collectorMode"
                value={collectorMode}
                onChange={(e) => setCollectorMode(e.target.value)}
              >
                <option value="self">Tôi nhận tính tiền</option>
                <option value="unknown">Chưa xác định</option>
                <option value="nominee">Đề cử người khác</option>
              </select>
            </label>
            {collectorMode === "nominee" && (
              <label>
                Người được đề cử
                <select name="nominee" required defaultValue="">
                  <option value="" disabled>
                    Chọn thành viên
                  </option>
                  {inGroup
                    .filter((m) => m.user_id && m.user_id !== userId)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Hạn chốt (để trống dùng giờ bắt đầu)
              <input name="commitDeadline" type="datetime-local" />
            </label>
            <p>
              Mỗi người tự chốt tham gia. Người được đề cử cần nhận vai trò
              riêng.
            </p>
          </>
        )}
        {flow === "played" && (
          <div className="form-step-actions">
            {step > 0 && (
              <button
                type="button"
                className="secondary"
                onClick={() => setStep(step - 1)}
              >
                Quay lại
              </button>
            )}
            {step < 2 && (
              <button
                type="button"
                className="primary"
                onClick={() => setStep(step + 1)}
              >
                {step === 0 ? "Chọn người chơi" : "Xem lại bảng chia"}
              </button>
            )}
          </div>
        )}
      </ActionForm>
    </section>
  );
}
