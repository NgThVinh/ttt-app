import FinishSessionForm from "@/components/finish-session-form";
import PaymentQr from "@/components/payment-qr";
import ReceiptPanel from "@/components/receipt-panel";
import SessionCalendarForm from "@/components/session-calendar-form";
import AdminSessionPanel from "@/components/admin-session-panel";
import ExpenseEditButton from "@/components/expense-edit-button";
import { expenseToolsSchema, expenseEditorSchema } from "@/lib/expense-tools";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { detailSchema } from "@/lib/session-data";
import { formatMoney } from "@/lib/money";
import { bankLabel } from "@/lib/banks";
import ActionForm from "@/components/action-form";
import ExpenseForm from "@/components/expense-form";
import SessionRequestForm from "@/components/session-request-form";
import ShareButton from "@/components/share-button";
import { weeklySeries } from "@/app/polls/actions";
import { sessionCommand, changePayment, inviteToSession } from "../actions";
import { remindPayment } from "@/app/notifications/actions";
import { createInvite } from "@/app/groups/actions";
import RsvpButtons from "@/components/rsvp-buttons";
import { Badge } from "@/components/ui/badge";
import {
  sessionDate,
  sessionTime,
  sessionStatus,
} from "@/lib/session-overview";
export default async function Session({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await db.rpc("session_details", { sid: id });
  if (error) notFound();
  const parsed = detailSchema.safeParse(data);
  if (!parsed.success)
    return (
      <main>
        <p role="alert">
          Dữ liệu buổi chưa hợp lệ. Kiểm tra migration và thử lại.
        </p>
      </main>
    );
  const s = parsed.data;
  const replacedResult = await db.rpc("replaced_payments", { sid: id });
  const replaced = z
    .array(
      z.object({
        id: z.uuid(),
        amount: z.string().regex(/^\d+$/),
        from_name: z.string(),
        to_name: z.string(),
        ref_code: z.string(),
        created_at: z.string(),
        reason: z.string().nullable(),
        can_read_evidence: z.boolean(),
      }),
    )
    .safeParse(replacedResult.data);
  const collector = s.my_member_id === s.collector_member_id;
  const { data: members } = await db
    .from("group_members")
    .select("id,display_name,user_id,role,status")
    .eq("group_id", s.group_id)
    .eq("status", "active");
  const { data: metadata } = await db
    .from("sessions")
    .select("created_by,weekly_series_id,note")
    .eq("id", id)
    .maybeSingle();
  const { data: allExpenses } = await db
    .from("expenses")
    .select("id,created_by,amount")
    .eq("session_id", id);
  const { data: paymentHistory } = await db
    .from("settlements")
    .select("id")
    .eq("session_id", id)
    .limit(1);
  const canManage = s.status === "planned" || s.status === "cancelled";
  const locked = s.calendar_locked;
  const [toolsResult, editorsResult] = await Promise.all([
    db.rpc("expense_tools", { g: s.group_id }),
    db.rpc("expense_editor_data", { sid: s.id }),
  ]);
  const tools = expenseToolsSchema.safeParse(toolsResult.data);
  const editors = z.array(expenseEditorSchema).safeParse(editorsResult.data);
  const admin = members?.some(
    (m) => m.user_id === user.id && m.role === "admin",
  );
  const canCancel =
    !!allExpenses &&
    !!paymentHistory &&
    !allExpenses.some((e) => BigInt(e.amount) !== 0n) &&
    paymentHistory.length === 0;
  const activeAttendees = s.attendees.filter((a) => !a.removed_at);
  const going = activeAttendees.filter(
    (a) => a.rsvp === "going" && a.committed_at,
  );
  const myAttendance = activeAttendees.find(
    (a) => a.member_id === s.my_member_id,
  );
  const total = s.expenses.reduce((n, e) => n + BigInt(e.amount), 0n);
  const myShare = s.expenses.reduce(
    (n, e) =>
      n +
      BigInt(
        e.allocations.find((a) => a.member_id === s.my_member_id)?.amount ||
          "0",
      ),
    0n,
  );
  const showBilling =
    s.status === "planned" && (!s.collector_member_id || collector);
  return (
    <main className="session-detail">
      <Link href="/sessions">Các buổi chơi</Link>
      <div className="page-heading detail-heading">
        <div>
          <h1>{s.title}</h1>
          <p className="inline-meta">
            <span>
              {sessionDate(s.starts_at)} · {sessionTime(s.starts_at)}
              {s.ends_at ? `–${sessionTime(s.ends_at)}` : ""}
            </span>
            <span>{s.venue}</span>
            <Badge>{sessionStatus[s.status]}</Badge>
          </p>
        </div>
        <ShareButton
          title={s.title}
          text={`${s.title} tại ${s.venue}. Xem lịch, chốt tham gia và phần tiền của bạn trong app.`}
          path={`/sessions/${s.id}`}
        />
      </div>
      <dl className="session-facts">
        <div>
          <dt>Tham gia</dt>
          <dd>
            {going.length}
            <small> / {activeAttendees.length} người</small>
          </dd>
        </div>
        <div>
          <dt>Phần của tôi</dt>
          <dd className="money">
            {s.status === "planned" ? "Chưa chốt" : formatMoney(myShare)}
            {s.status !== "planned" && <small>Tổng {formatMoney(total)}</small>}
          </dd>
        </div>
        <div>
          <dt>Người tính tiền</dt>
          <dd>
            {members?.find((m) => m.id === s.collector_member_id)
              ?.display_name || "Chưa có"}
          </dd>
        </div>
      </dl>
      {metadata?.note && (
        <p style={{ whiteSpace: "pre-wrap" }}>{metadata.note}</p>
      )}
      {s.booking_locked && s.status !== "cancelled" && (
        <p className="booking-lock">
          Đã chốt chi phí · Lịch và danh sách tham gia đã khóa.
        </p>
      )}
      <div
        className={`session-detail-grid${showBilling ? "" : " single-column"}`}
      >
        <div className="detail-main">
          {s.settlements.length > 0 && (
            <section className="panel payment-list">
              <div className="section-heading">
                <h2>Thanh toán</h2>
                <small>
                  {s.settlements.filter((p) => p.status === "confirmed").length}
                  /{s.settlements.length} đã nhận
                </small>
              </div>
              {s.settlements.some(
                (p) =>
                  p.to_member === s.my_member_id && p.status !== "confirmed",
              ) && (
                <p className="field-hint">
                  Kiểm tra mã và số tiền trong sao kê trước khi xác nhận nhận
                  tiền.
                </p>
              )}
              {[...s.settlements]
                .sort(
                  (a, b) =>
                    Number(a.status === "confirmed") -
                    Number(b.status === "confirmed"),
                )
                .map((p) => (
                  <article className="session-row payment-row" key={p.id}>
                    <div>
                      <div className="payment-row-heading">
                        <strong>
                          {p.from_name} → {p.to_name}
                        </strong>
                        <strong className="money">
                          {formatMoney(p.amount)}
                        </strong>
                      </div>
                      <p className="inline-meta">
                        <Badge
                          tone={
                            p.status === "confirmed"
                              ? "success"
                              : p.status === "marked_paid"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {p.status === "confirmed"
                            ? "Đã nhận"
                            : p.status === "marked_paid"
                              ? "Đã chuyển · Chờ xác nhận"
                              : "Chưa trả"}
                        </Badge>
                        <span>3T-{p.ref_code}</span>
                        {p.kind === "adjustment" && <span>Điều chỉnh</span>}
                      </p>

                      {collector &&
                        p.to_member === s.my_member_id &&
                        p.status === "pending" && (
                          <ActionForm
                            action={remindPayment}
                            label="Nhắc thanh toán"
                            className="inline-action"
                          >
                            <input type="hidden" name="target" value={p.id} />
                          </ActionForm>
                        )}
                      {p.status !== "confirmed" &&
                        p.from_member === s.my_member_id && (
                          <>
                            {p.bank_account_no ? (
                              <p>
                                {bankLabel(p.bank_bin)} · Tài khoản{" "}
                                {p.bank_account_no} · {p.bank_account_name}
                              </p>
                            ) : (
                              <p>Người nhận chưa lưu tài khoản ngân hàng.</p>
                            )}
                            {p.bank_account_no && p.bank_bin && (
                              <PaymentQr
                                bin={p.bank_bin}
                                account={p.bank_account_no}
                                amount={p.amount}
                                reference={p.ref_code}
                                name={p.bank_account_name || p.to_name}
                              />
                            )}
                            <ActionForm
                              action={changePayment}
                              disabled={p.status !== "pending"}
                              label="Tôi đã chuyển"
                              className="inline-action"
                            >
                              <input type="hidden" name="id" value={p.id} />
                              <input
                                type="hidden"
                                name="operation"
                                value="mark"
                              />
                            </ActionForm>
                          </>
                        )}
                      {p.status !== "confirmed" &&
                        p.to_member === s.my_member_id && (
                          <ActionForm
                            action={changePayment}
                            label="Đã nhận"
                            className="inline-action"
                          >
                            <input type="hidden" name="id" value={p.id} />
                            <input
                              type="hidden"
                              name="operation"
                              value="confirm"
                            />
                          </ActionForm>
                        )}
                      <details className="payment-evidence">
                        <summary>Bằng chứng thanh toán (tùy chọn)</summary>{" "}
                        <ReceiptPanel
                          bucket="3t-payment-evidence"
                          target={p.id}
                          canUpload={p.from_member === s.my_member_id}
                        />
                      </details>
                    </div>
                  </article>
                ))}
            </section>
          )}
          <section className="panel">
            <div className="section-heading">
              <h2>Người tham gia</h2>
              <small>
                {going.length} đi ·{" "}
                {
                  activeAttendees.filter(
                    (a) =>
                      a.rsvp !== "not_going" &&
                      !(a.rsvp === "going" && a.committed_at),
                  ).length
                }{" "}
                chờ
              </small>
            </div>
            {s.status === "planned" && (
              <RsvpButtons
                key={`rsvp-${s.revision}`}
                sid={s.id}
                revision={s.revision}
                value={
                  myAttendance?.rsvp === "going" && myAttendance.committed_at
                    ? "going"
                    : myAttendance?.rsvp === "not_going"
                      ? "not_going"
                      : "pending"
                }
              />
            )}
            <ul className="attendee-chips" aria-label="Danh sách tham gia">
              {activeAttendees.map((a) => {
                const status =
                  a.rsvp === "going" && a.committed_at
                    ? "going"
                    : a.rsvp === "not_going"
                      ? "declined"
                      : "waiting";
                return (
                  <li key={a.member_id} className={status}>
                    <span aria-hidden className="attendee-dot" />
                    {a.name}
                    <small>
                      {status === "going"
                        ? "Đã nhận lời"
                        : status === "declined"
                          ? "Không đi"
                          : "Chờ trả lời"}
                      {Number(a.weight) !== 1 ? ` · ×${a.weight}` : ""}
                    </small>
                  </li>
                );
              })}
            </ul>
            {s.status === "planned" && (
              <details>
                <summary>Mời thêm người tham gia</summary>
                <ActionForm action={inviteToSession} label="Gửi lời mời">
                  <input type="hidden" name="sid" value={s.id} />
                  <fieldset className="participant-list">
                    <legend>Thành viên trong nhóm</legend>
                    {(members || [])
                      .filter(
                        (m) => !s.attendees.some((a) => a.member_id === m.id),
                      )
                      .map((m) => (
                        <label key={m.id}>
                          <input type="checkbox" name="people" value={m.id} />
                          {m.display_name}
                        </label>
                      ))}
                  </fieldset>
                </ActionForm>
                <ActionForm
                  action={createInvite}
                  label="Tạo link mời bạn mới vào buổi"
                >
                  <input type="hidden" name="groupId" value={s.group_id} />
                  <input type="hidden" name="session_id" value={s.id} />
                  <input type="hidden" name="days" value="7" />
                  <input type="hidden" name="uses" value="30" />
                  <p>
                    Bạn mới vào nhóm qua link này, rồi tự nhận lời tham gia
                    buổi. Link có hiệu lực 7 ngày, tối đa 30 lượt.
                  </p>
                </ActionForm>
              </details>
            )}
          </section>
          {s.expenses.length > 0 && (
            <section className="panel expense-summary">
              <div className="section-heading">
                <h2>Chi phí</h2>
                <strong className="money">{formatMoney(total)}</strong>
              </div>
              {s.expenses.map((e) => (
                <div className="session-row" key={e.id}>
                  <div>
                    <div className="section-heading">
                      <strong>{e.title}</strong>
                      <strong className="money">{formatMoney(e.amount)}</strong>
                    </div>
                    <p className="inline-meta">
                      <span>{e.paid_by_name || "Người tính tiền"} ứng</span>
                      <span>
                        Phần của tôi{" "}
                        <b className="money">
                          {formatMoney(
                            e.allocations.find(
                              (a) => a.member_id === s.my_member_id,
                            )?.amount || "0",
                          )}
                        </b>
                      </span>
                    </p>
                    <details>
                      <summary>Chi tiết chia & hóa đơn</summary>
                      <p>
                        {e.category_name || "Khoản chi"}
                        {e.created_by_name
                          ? ` · ${e.created_by_name} thêm`
                          : ""}
                      </p>
                      {e.note && (
                        <p style={{ whiteSpace: "pre-wrap" }}>{e.note}</p>
                      )}
                      {e.allocations.map((a) => (
                        <small className="allocation-row" key={a.member_id}>
                          <span>
                            {s.attendees.find(
                              (m) => m.member_id === a.member_id,
                            )?.name || "Thành viên"}
                          </span>
                          <span className="money">{formatMoney(a.amount)}</span>
                        </small>
                      ))}
                      <ReceiptPanel
                        bucket="3t-expense-receipts"
                        target={e.id}
                        canUpload={collector && !locked}
                      />
                    </details>
                    {!locked &&
                      editors.success &&
                      editors.data.find((x) => x.id === e.id)?.can_edit && (
                        <ExpenseEditButton
                          key={`${e.id}-${s.revision}`}
                          id={e.id}
                        />
                      )}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
        {showBilling && (
          <aside className="detail-sidebar">
            {!s.collector_member_id && s.status === "planned" && (
              <section className="panel">
                <h2>Người tính tiền</h2>
                <p>
                  Lưu ngân hàng trong <Link href="/me">hồ sơ</Link> trước khi
                  nhận vai trò.
                </p>
                <ActionForm
                  action={sessionCommand}
                  label="Nhận vai trò người tính tiền"
                >
                  <input type="hidden" name="sid" value={s.id} />
                  <input type="hidden" name="revision" value={s.revision} />
                  <input type="hidden" name="operation" value="claim" />
                  <input type="hidden" name="court" value="0" />
                </ActionForm>
              </section>
            )}
            {collector && s.status === "planned" && (
              <FinishSessionForm session={s} />
            )}
          </aside>
        )}
      </div>
      {replaced.success && replaced.data.length > 0 && (
        <section className="panel">
          <h2>Khoản đã thay thế</h2>
          <p>
            Các khoản này giữ lại lịch sử và bằng chứng. Hãy dùng khoản hiện tại
            để báo chuyển và xác nhận lại.
          </p>
          {replaced.data.map((p) => (
            <article key={p.id} className="session-row">
              <div>
                <strong>
                  {p.from_name} → {p.to_name}: {formatMoney(p.amount)}
                </strong>
                <p>3T-{p.ref_code} · Đã thay thế</p>
                {p.reason && <p>{p.reason}</p>}
                {p.can_read_evidence && (
                  <ReceiptPanel bucket="3t-payment-evidence" target={p.id} />
                )}
              </div>
            </article>
          ))}
        </section>
      )}
      {s.status !== "planned" &&
        s.status !== "cancelled" &&
        collector &&
        !locked && (
          <>
            <details className="panel">
              <summary>Thêm khoản chi hoặc giảm giá</summary>
              <ExpenseForm
                session={s}
                tools={tools.success ? tools.data : undefined}
              />
            </details>
          </>
        )}
      {s.status === "planned" && (
        <details className="panel">
          <summary>Gửi đề nghị thay đổi</summary>
          <SessionRequestForm
            session={s}
            members={members || []}
            canNominate={true}
          />
        </details>
      )}
      <p>
        <Link href="/approvals">Chờ tôi duyệt và các yêu cầu đã gửi</Link>
      </p>
      {canManage && !locked && (
        <SessionCalendarForm
          key={s.revision}
          session={s}
          note={metadata?.note || null}
          canCancel={canCancel}
        />
      )}
      {admin && <AdminSessionPanel key={`admin-${s.revision}`} session={s} />}
      {metadata?.created_by === user.id && s.status === "planned" && (
        <details className="panel">
          <summary>Lịch lặp hàng tuần</summary>
          {metadata.weekly_series_id ? (
            <ActionForm action={weeklySeries} label="Dừng tạo buổi lặp mới">
              <input
                type="hidden"
                name="id"
                value={metadata.weekly_series_id}
              />
              <input type="hidden" name="operation" value="stop" />
            </ActionForm>
          ) : (
            <ActionForm action={weeklySeries} label="Bật lặp hàng tuần">
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="operation" value="start" />
              <label htmlFor="repeat-weeks">Số tuần tiếp theo (1–12)</label>
              <input
                id="repeat-weeks"
                name="weeks"
                type="number"
                min="1"
                max="12"
                defaultValue="4"
                required
              />
              <p>
                Buổi mới chưa có người tính tiền; mỗi người tự chốt. Hệ thống
                tạo trước tối đa 4 tuần.
              </p>
            </ActionForm>
          )}
        </details>
      )}
      <details className="panel session-history">
        <summary>
          Lịch sử <small>({s.history.length})</small>
        </summary>
        {s.history.map((h, i) => (
          <p key={i}>
            {new Date(h.created_at).toLocaleString("vi-VN", {
              timeZone: "Asia/Ho_Chi_Minh",
            })}{" "}
            · {h.actor_name || "Thành viên"} ·{" "}
            {h.action === "session_metadata_updated"
              ? "Sửa thông tin buổi"
              : h.action === "session_cancelled"
                ? "Hủy buổi"
                : h.action === "session_reopened"
                  ? "Mở lại buổi"
                  : h.action === "rsvp_reset"
                    ? "Mời tự chốt lại sau khi đổi lịch"
                    : h.action === "approval_requested"
                      ? "Gửi yêu cầu duyệt"
                      : h.action === "approval_approved"
                        ? "Duyệt yêu cầu"
                        : h.action === "approval_rejected"
                          ? "Từ chối yêu cầu"
                          : h.action === "collector_transfer_consented"
                            ? "Đồng ý chuyển người tính tiền"
                            : h.action === "committed_going"
                              ? "Chốt đi"
                              : h.action === "committed_not_going"
                                ? "Chốt không đi"
                                : h.action === "added_by_collector" ||
                                    h.action === "added" ||
                                    h.action === "join_approved"
                                  ? "Thêm người tham gia"
                                  : h.action === "removed" ||
                                      h.action === "leave_approved"
                                    ? "Rút khỏi buổi"
                                    : h.action === "weight_changed" ||
                                        h.action === "weight_approved"
                                      ? "Đổi hệ số"
                                      : h.action === "money_recalculated"
                                        ? "Tính lại tiền"
                                        : h.action === "session_created"
                                          ? "Tạo buổi"
                                          : h.action === "confirm"
                                            ? "Xác nhận đã nhận"
                                            : h.action === "mark"
                                              ? "Báo đã chuyển"
                                              : h.action === "collector_claimed"
                                                ? "Nhận vai trò tính tiền"
                                                : "Cập nhật buổi"}
            {h.reason ? ` · ${h.reason}` : ""}
          </p>
        ))}
      </details>
    </main>
  );
}
export const metadata = { title: "Chi tiết buổi chơi" };
