import FinishSessionForm from "@/components/finish-session-form";
import ReceiptPanel from "@/components/receipt-panel";
import SessionHeader from "@/components/session-header";
import SessionCollector from "@/components/session-collector";
import SessionInvite from "@/components/session-invite";
import AdminSessionPanel from "@/components/admin-session-panel";
import ExpenseEditButton from "@/components/expense-edit-button";
import { expenseToolsSchema, expenseEditorSchema } from "@/lib/expense-tools";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { detailSchema } from "@/lib/session-data";
import { formatMoney } from "@/lib/money";
import ActionForm from "@/components/action-form";
import ExpenseForm from "@/components/expense-form";
import { weeklySeries } from "@/app/polls/actions";
import { inviteToSession } from "../actions";
import { createInvite } from "@/app/groups/actions";
import SessionParticipants from "@/components/session-participants";
import SessionPayments from "@/components/session-payments";
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
  const inviteCandidates = (members || []).filter(
    (m) => !s.attendees.some((a) => a.member_id === m.id),
  );
  const total = s.expenses.reduce((n, e) => n + BigInt(e.amount), 0n);
  const { data: nominations } = await db
    .from("approval_requests")
    .select("id,payload_hash,required_authority,payload")
    .eq("session_id", s.id)
    .eq("type", "collector_nomination")
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  const nomination = z
    .object({
      id: z.uuid(),
      payload_hash: z.string(),
      required_authority: z.string(),
      payload: z.object({ member_id: z.uuid().optional() }),
    })
    .safeParse(nominations?.[0]);
  const participants = (
    <SessionParticipants key={s.revision} session={s}>
      {s.status === "planned" && (
        <SessionInvite>
          {" "}
          {!!inviteCandidates.length ? (
            <ActionForm action={inviteToSession} label="Gửi lời mời">
              <input type="hidden" name="sid" value={s.id} />
              <fieldset className="participant-list">
                <legend>Thành viên trong nhóm</legend>
                {inviteCandidates.map((m) => (
                  <label key={m.id}>
                    <input type="checkbox" name="people" value={m.id} />
                    {m.display_name}
                  </label>
                ))}
              </fieldset>
            </ActionForm>
          ) : (
            <p className="field-hint">Mọi thành viên trong nhóm đã được mời.</p>
          )}
          <ActionForm
            action={createInvite}
            label="Tạo link mời bạn mới vào buổi"
          >
            <input type="hidden" name="groupId" value={s.group_id} />
            <input type="hidden" name="session_id" value={s.id} />
            <input type="hidden" name="days" value="7" />
            <input type="hidden" name="uses" value="30" />
            <p>
              Bạn mới vào nhóm qua link này, rồi tự nhận lời tham gia buổi. Link
              có hiệu lực 7 ngày, tối đa 30 lượt.
            </p>
          </ActionForm>
        </SessionInvite>
      )}
    </SessionParticipants>
  );
  const costs = (
    <section className="panel expense-summary">
      <div className="section-heading">
        <h2>Chi phí buổi chơi</h2>
        {s.status !== "planned" && (
          <strong className="money">{formatMoney(total)}</strong>
        )}
      </div>
      <SessionCollector
        key={s.revision}
        session={s}
        members={members || []}
        request={nomination.success ? nomination.data : undefined}
      />
      {s.status === "planned" &&
        (collector ? (
          <FinishSessionForm
            key={s.revision}
            session={s}
            tools={tools.success ? tools.data : undefined}
          />
        ) : (
          <p className="cost-empty">Chưa có hóa đơn.</p>
        ))}
      {s.status !== "planned" &&
        s.status !== "cancelled" &&
        collector &&
        !locked && (
          <details className="cost-adjust">
            <summary>Thêm khoản chi hoặc giảm giá</summary>
            <ExpenseForm
              session={s}
              tools={tools.success ? tools.data : undefined}
            />
          </details>
        )}
      {s.expenses
        .filter(
          (e) =>
            s.status !== "planned" ||
            (e.kind ? e.kind !== "court" : e.title !== "Tiền sân"),
        )
        .map((e) => (
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
                      e.allocations.find((a) => a.member_id === s.my_member_id)
                        ?.amount || "0",
                    )}
                  </b>
                </span>
              </p>
              <details>
                <summary>Chi tiết chia & hóa đơn</summary>
                <p>
                  {e.category_name || "Khoản chi"}
                  {e.created_by_name ? ` · ${e.created_by_name} thêm` : ""}
                </p>
                {e.note && <p style={{ whiteSpace: "pre-wrap" }}>{e.note}</p>}
                {e.allocations.map((a) => (
                  <small className="allocation-row" key={a.member_id}>
                    <span>
                      {s.attendees.find((m) => m.member_id === a.member_id)
                        ?.name || "Thành viên"}
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
                  <ExpenseEditButton key={`${e.id}-${s.revision}`} id={e.id} />
                )}
            </div>
          </div>
        ))}
    </section>
  );
  return (
    <main className="session-detail">
      <Link href="/sessions">Các buổi chơi</Link>
      <SessionHeader
        key={s.revision}
        session={s}
        note={metadata?.note || null}
        canCancel={canCancel}
        now={new Date().getTime()}
      />
      <div
        className="session-detail-grid"
        data-session-state={s.status}
        data-collector={collector}
      >
        <div className="detail-main">
          {s.status !== "planned" && s.status !== "cancelled" && (
            <SessionPayments session={s} />
          )}
          {s.status === "played" ||
          s.status === "settled" ||
          (s.status === "planned" && collector) ? (
            <>
              {costs}
              {participants}
            </>
          ) : (
            <>
              {participants}
              {costs}
            </>
          )}
        </div>
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
    </main>
  );
}
export const metadata = { title: "Chi tiết buổi chơi" };
