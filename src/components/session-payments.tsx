import type { SessionDetail } from "@/lib/session-data";
import { formatMoney } from "@/lib/money";
import { bankLabel } from "@/lib/banks";
import PaymentQr from "./payment-qr";
import ReceiptPanel from "./receipt-panel";
import ActionForm from "./action-form";
import { Badge } from "./ui/badge";
import { changePayment } from "@/app/sessions/actions";
import { remindPayment } from "@/app/notifications/actions";
import SessionTask from "./session-task";
export default function SessionPayments({
  session: s,
}: {
  session: SessionDetail;
}) {
  const collector = s.my_member_id === s.collector_member_id;
  const mine = s.settlements.filter(
      (p) => p.from_member === s.my_member_id || p.to_member === s.my_member_id,
    ),
    open = mine.filter((p) => p.status !== "confirmed"),
    done = mine.filter((p) => p.status === "confirmed"),
    other = s.settlements.filter((p) => !mine.some((m) => m.id === p.id));
  const due = open
      .filter((p) => p.from_member === s.my_member_id)
      .reduce((n, p) => n + BigInt(p.amount), 0n),
    incoming = open
      .filter((p) => p.to_member === s.my_member_id)
      .reduce((n, p) => n + BigInt(p.amount), 0n);
  const needsConfirm = open.filter(
    (p) => p.to_member === s.my_member_id && p.status === "marked_paid",
  ).length;
  const singleOutgoing =
    open.length === 1 && open[0].from_member === s.my_member_id
      ? open[0]
      : undefined;
  const ordered = [...open].sort(
    (a, b) =>
      Number(b.status === "marked_paid" && b.to_member === s.my_member_id) -
      Number(a.status === "marked_paid" && a.to_member === s.my_member_id),
  );
  const waiting = open.filter(
    (p) => p.to_member === s.my_member_id && p.status === "pending",
  );
  const visible = ordered.filter(
    (p) => p.from_member === s.my_member_id || p.status === "marked_paid",
  );
  const renderRow = (p: SessionDetail["settlements"][number]) => (
    <article
      className="session-row payment-row"
      key={p.id}
      data-payment-id={p.id}
    >
      <div>
        <div className="payment-row-heading">
          <strong>
            {p.id === singleOutgoing?.id
              ? `${p.status === "pending" ? "Cần chuyển" : "Đã báo chuyển"} cho ${p.to_name}`
              : p.from_member === s.my_member_id
                ? `Chuyển cho ${p.to_name}`
                : `${p.from_name} → ${p.to_name}`}
          </strong>
          {!(
            p.from_member === s.my_member_id &&
            p.status !== "confirmed" &&
            open.filter((item) => item.from_member === s.my_member_id)
              .length === 1
          ) && <strong className="money">{formatMoney(p.amount)}</strong>}
        </div>
        {p.id === singleOutgoing?.id && (
          <strong className="personal-payment-amount">
            {formatMoney(p.amount)}
          </strong>
        )}
        <p
          className="inline-meta"
          role={p.status === "marked_paid" ? "status" : undefined}
        >
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
                ? "Đã báo chuyển · Chờ xác nhận"
                : "Chưa chuyển"}
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
        {p.status === "pending" && p.from_member === s.my_member_id && (
          <SessionTask label="Thanh toán" title={`Thanh toán cho ${p.to_name}`}>
            <p className="payment-task-amount money">{formatMoney(p.amount)}</p>
            {p.bank_account_no ? (
              <p>
                {bankLabel(p.bank_bin)} · Tài khoản {p.bank_account_no} ·{" "}
                {p.bank_account_name}
              </p>
            ) : (
              <p>Người nhận chưa lưu tài khoản ngân hàng.</p>
            )}
            {p.bank_account_no && p.bank_bin && (
              <PaymentQr
                compact
                bin={p.bank_bin}
                account={p.bank_account_no}
                amount={p.amount}
                reference={p.ref_code}
                name={p.bank_account_name || p.to_name}
              />
            )}
            <p className="payment-task-reference">
              Nội dung chuyển khoản: <strong>3T-{p.ref_code}</strong>
            </p>
            <ActionForm
              action={changePayment}
              label="Tôi đã chuyển"
              className="inline-action"
            >
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="operation" value="mark" />
            </ActionForm>
            <details className="payment-evidence">
              <summary>Bằng chứng thanh toán (tùy chọn)</summary>
              <ReceiptPanel
                bucket="3t-payment-evidence"
                target={p.id}
                canUpload
              />
            </details>
          </SessionTask>
        )}
        {p.status !== "confirmed" && p.to_member === s.my_member_id && (
          <ActionForm
            action={changePayment}
            label="Đã nhận"
            className="inline-action"
          >
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="operation" value="confirm" />
          </ActionForm>
        )}
        {!(p.status === "pending" && p.from_member === s.my_member_id) && (
          <details className="payment-evidence">
            <summary>Bằng chứng thanh toán (tùy chọn)</summary>{" "}
            <ReceiptPanel
              bucket="3t-payment-evidence"
              target={p.id}
              canUpload={p.from_member === s.my_member_id}
            />
          </details>
        )}
      </div>
    </article>
  );
  return (
    <>
      <section className="panel payment-list" aria-label="Thanh toán của bạn">
        <div className="section-heading">
          <h2>{needsConfirm ? "Cần bạn xác nhận" : "Thanh toán của bạn"}</h2>
          {collector && (
            <small>
              {s.settlements.filter((p) => p.status === "confirmed").length}/
              {s.settlements.length} khoản đã nhận
            </small>
          )}
        </div>
        {!singleOutgoing && (
          <div className="personal-payment-summary">
            {due > 0n && (
              <div>
                <span>
                  {open.some(
                    (p) =>
                      p.from_member === s.my_member_id &&
                      p.status === "pending",
                  )
                    ? "Bạn cần chuyển"
                    : "Đã báo chuyển"}
                </span>
                <strong className="personal-payment-amount">
                  {formatMoney(due)}
                </strong>
              </div>
            )}
            {incoming > 0n && (
              <div>
                <span>{collector ? "Còn cần nhận" : "Bạn được nhận lại"}</span>
                <strong className="personal-payment-amount">
                  {formatMoney(incoming)}
                </strong>
              </div>
            )}
            {!open.length && (
              <p className="payment-complete">
                {done.some((p) => p.from_member === s.my_member_id)
                  ? "Bạn đã thanh toán xong"
                  : done.length
                    ? "Bạn đã nhận đủ tiền"
                    : "Bạn không có khoản cần thanh toán"}
              </p>
            )}
          </div>
        )}
        {needsConfirm > 0 && (
          <p className="payment-check-hint">
            {needsConfirm ? `${needsConfirm} khoản đã báo chuyển. ` : ""}Kiểm
            tra sao kê trước khi xác nhận nhận tiền.
          </p>
        )}
        {visible.map(renderRow)}
        {!!waiting.length && (
          <p className="payment-waiting-names">
            Chờ {waiting.map((p) => p.from_name).join(", ")} chuyển tiền.
          </p>
        )}
        {!!waiting.length && (
          <details className="payment-archive payment-waiting">
            <summary>Chưa báo chuyển · {waiting.length} người</summary>
            {waiting.map(renderRow)}
          </details>
        )}
        {!!done.length && (
          <details className="payment-archive">
            <summary>Khoản đã hoàn tất · {done.length}</summary>
            {done.map(renderRow)}
          </details>
        )}
      </section>
      {!!other.length && (
        <details className="session-payment-directory">
          <summary>Các khoản khác trong buổi · {other.length}</summary>
          {other.map(renderRow)}
        </details>
      )}
    </>
  );
}
