import FinishSessionForm from "@/components/finish-session-form";
import PaymentQr from "@/components/payment-qr";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { detailSchema } from "@/lib/session-data";
import { formatMoney } from "@/lib/money";
import ActionForm from "@/components/action-form";
import ExpenseForm from "@/components/expense-form";
import FinancialChangeForm from "@/components/financial-change-form";
import SessionRequestForm from "@/components/session-request-form";
import { sessionCommand, changePayment } from "../actions";
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
  const collector = s.my_member_id === s.collector_member_id;
  const due = s.deadline_passed;
  const { data: members } = await db
    .from("group_members")
    .select("id,display_name,user_id")
    .eq("group_id", s.group_id)
    .eq("status", "active");
  const { data: metadata } = await db
    .from("sessions")
    .select("created_by")
    .eq("id", id)
    .maybeSingle();
  return (
    <main>
      <Link href="/sessions">Các buổi chơi</Link>
      <h1>{s.title}</h1>
      <p>
        {s.venue} ·{" "}
        {new Date(s.starts_at).toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
        })}
      </p>
      <p>
        {s.status === "settled"
          ? "Đã thu đủ"
          : s.status === "planned"
            ? "Sắp tới"
            : "Đang thu tiền"}{" "}
        ·{" "}
        {s.collector_member_id
          ? "Đã có người tính tiền"
          : "Chờ người thanh toán"}
      </p>
      <section className="panel">
        <h2>Người tham gia</h2>
        {s.attendees.map((a) => (
          <p key={a.member_id}>
            {a.name} ·{" "}
            {a.rsvp === "going" && a.committed_at
              ? "Đã chốt đi"
              : a.rsvp === "not_going"
                ? "Không đi"
                : "Chưa chốt"}{" "}
            · Hệ số {a.weight}
          </p>
        ))}
        {s.status === "planned" && !due && (
          <ActionForm action={sessionCommand} label="Chốt lựa chọn của tôi">
            <input type="hidden" name="sid" value={s.id} />
            <input type="hidden" name="revision" value={s.revision} />
            <select name="operation" aria-label="Tôi tham gia">
              <option value="going">Tôi đi</option>
              <option value="not_going">Tôi không đi</option>
            </select>
          </ActionForm>
        )}
        {s.status === "planned" && due && (
          <p>Đã qua hạn chốt; thay đổi cần người tính tiền duyệt.</p>
        )}
      </section>
      {!s.collector_member_id && (
        <section className="panel">
          <h2>Tôi là người trả</h2>
          <p>
            Lưu ngân hàng trong <Link href="/me">hồ sơ</Link> trước khi nhận vai
            trò.
          </p>
          <ActionForm
            action={sessionCommand}
            label="Nhận vai trò người tính tiền"
          >
            <input type="hidden" name="sid" value={s.id} />
            <input type="hidden" name="revision" value={s.revision} />
            <input type="hidden" name="operation" value="claim" />
            <label htmlFor="claim-court">Tiền sân (đ)</label>
            <input id="claim-court" name="court" required pattern="[0-9]+" />
          </ActionForm>
        </section>
      )}
      {collector && s.status === "planned" && due && (
        <FinishSessionForm session={s} />
      )}
      <section className="panel">
        <h2>Tiền của tôi đến từ đâu?</h2>
        {s.expenses.map((e) => (
          <div className="session-row" key={e.id}>
            <div>
              <strong>
                {e.title} · {formatMoney(e.amount)}
              </strong>
              <p>
                Phần của tôi:{" "}
                {formatMoney(
                  e.allocations.find((a) => a.member_id === s.my_member_id)
                    ?.amount || "0",
                )}
              </p>
              {e.allocations.map((a) => (
                <small style={{ display: "block" }} key={a.member_id}>
                  {s.attendees.find((m) => m.member_id === a.member_id)?.name ||
                    "Thành viên"}
                  : {formatMoney(a.amount)}
                </small>
              ))}
            </div>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Thanh toán</h2>
        {!s.settlements.length && <p>Chưa có khoản cần chuyển.</p>}
        {s.settlements.map((p) => (
          <article className="session-row" key={p.id}>
            <div>
              <strong>
                {p.from_name} trả {p.to_name}: {formatMoney(p.amount)}
              </strong>
              <p>
                {p.status === "confirmed"
                  ? "Đã nhận"
                  : p.status === "marked_paid"
                    ? "Người chuyển đã báo chuyển, chờ xác nhận"
                    : "Chưa trả"}
                {p.kind === "adjustment" ? " · Khoản điều chỉnh" : ""}
              </p>
              <p>
                Mã tham chiếu: <b>3T-{p.ref_code}</b>
              </p>
              {p.status !== "confirmed" && p.from_member === s.my_member_id && (
                <>
                  {p.bank_account_no ? (
                    <p>
                      Ngân hàng BIN {p.bank_bin} · Tài khoản {p.bank_account_no}{" "}
                      · {p.bank_account_name}
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
                  >
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="operation" value="mark" />
                  </ActionForm>
                </>
              )}
              {p.status !== "confirmed" && p.to_member === s.my_member_id && (
                <>
                  <p>
                    Tìm mã này và đúng số tiền trong sao kê trước khi xác nhận.
                  </p>
                  <ActionForm action={changePayment} label="Đã nhận">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="operation" value="confirm" />
                  </ActionForm>
                </>
              )}
            </div>
          </article>
        ))}
      </section>
      {s.status !== "planned" &&
        s.status !== "cancelled" &&
        (collector ||
          s.attendees.some(
            (a) =>
              a.member_id === s.my_member_id &&
              a.rsvp === "going" &&
              !a.removed_at,
          )) && (
          <>
            <ExpenseForm session={s} />
            {collector && (
              <FinancialChangeForm session={s} members={members || []} />
            )}
          </>
        )}
      {s.status !== "cancelled" && (
        <SessionRequestForm
          session={s}
          members={members || []}
          canNominate={collector || metadata?.created_by === user.id}
        />
      )}
      <p>
        <Link href="/approvals">Chờ tôi duyệt và các yêu cầu đã gửi</Link>
      </p>
      <section className="panel">
        <h2>Lịch sử</h2>
        {s.history.map((h, i) => (
          <p key={i}>
            {new Date(h.created_at).toLocaleString("vi-VN", {
              timeZone: "Asia/Ho_Chi_Minh",
            })}{" "}
            · {h.actor_name || "Thành viên"} ·{" "}
            {h.action === "approval_requested"
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
      </section>
    </main>
  );
}
