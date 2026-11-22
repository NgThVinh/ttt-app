import { z } from "zod";
import { formatMoney } from "@/lib/money";
import type { expenseReview } from "@/lib/ai/harness/expense-review";
const commands: Record<string, string> = {
  rsvp: "Chốt tham gia",
  vote: "Bỏ phiếu lịch chơi",
  mark_paid: "Báo đã chuyển tiền",
  confirm_received: "Xác nhận đã nhận tiền",
  expense: "Thêm hoặc sửa khoản chi",
  claim_collector: "Nhận vai trò tính tiền",
  reminder: "Nhắc thanh toán",
  session_request: "Gửi yêu cầu thay đổi buổi",
  create_session: "Tạo buổi chơi",
  create_poll: "Tạo thăm dò lịch",
};
export default function AIDraftReview({
  command,
  body,
  members,
  review,
  payment,
}: {
  command: string;
  body: Record<string, unknown>;
  members: { id: string; display_name: string }[];
  review: ReturnType<typeof expenseReview> | null;
  payment: {
    from_name: string;
    to_name: string;
    amount: string;
    ref_code: string;
  } | null;
}) {
  const name = (id: unknown) =>
    members.find((m) => m.id === id)?.display_name || "Thành viên";
  const money = (v: unknown) =>
    typeof v === "string" && /^-?\d+$/.test(v)
      ? formatMoney(v)
      : "Chưa xác định";
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const ids = z.array(z.string()).safeParse(body.beneficiaries || body.people);
  const request = z.record(z.string(), z.unknown()).safeParse(body.request);
  const options = z
    .array(z.object({ starts_at: z.string(), ends_at: z.string() }))
    .safeParse(body.options);
  const time = (v: unknown) =>
    new Date(text(v)).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  return (
    <section className="panel">
      <h2>{commands[command] || "Yêu cầu từ AI"}</h2>
      {command === "rsvp" && <p>{body.going ? "Tôi đi" : "Tôi không đi"}</p>}
      {command === "vote" && (
        <p>
          Lựa chọn:{" "}
          {
            (
              { yes: "Có", maybe: "Có thể", no: "Không" } as Record<
                string,
                string
              >
            )[text(body.answer)]
          }
        </p>
      )}
      {payment && (
        <p>
          <strong>
            {payment.from_name} → {payment.to_name}:{" "}
            {formatMoney(payment.amount)}
          </strong>
          <br />
          Mã tham chiếu: 3T-{payment.ref_code}
        </p>
      )}
      {(command === "expense" ||
        command === "create_session" ||
        command === "create_poll") && (
        <>
          <p>
            <strong>{text(body.title_text)}</strong>
          </p>
          {command === "expense" ? (
            <>
              <p>
                {body.mode === "per_person" ? "Đơn giá mỗi người" : "Số tiền"}:{" "}
                <strong>{money(body.raw_amount)}</strong>
              </p>
              <p>Người ứng: {name(body.payer)}</p>
              <p>
                Cách chia:{" "}
                {
                  (
                    {
                      equal: "Chia đều",
                      weighted: "Theo hệ số",
                      exact: "Số tiền cụ thể",
                      percent: "Phần trăm",
                    } as Record<string, string>
                  )[text(body.split)]
                }
              </p>
            </>
          ) : (
            <p>Địa điểm: {text(body.venue_text)}</p>
          )}
          {command === "create_session" && (
            <>
              <p>
                {body.already_played ? "Buổi đã chơi" : "Hẹn trước"} ·{" "}
                {time(body.start_time)}
              </p>
              <p>Hạn chốt: {time(body.deadline)}</p>
              <p>Tiền sân: {money(body.court)}</p>
              <p>
                Người tính tiền:{" "}
                {body.be_collector
                  ? "Người gửi nhận vai trò"
                  : body.nominee
                    ? `Đề cử ${name(body.nominee)}; cần nhận riêng`
                    : "Chưa xác định"}
              </p>
            </>
          )}
          {ids.success && ids.data.length > 0 && (
            <p>
              {command === "expense" ? "Người chịu" : "Người tham gia"}:{" "}
              {ids.data.map(name).join(", ")}
            </p>
          )}
        </>
      )}
      {command === "claim_collector" && (
        <p>Tiền sân: {money(body.court)}. Người gửi nhận vai trò tính tiền.</p>
      )}
      {request.success && (
        <p>
          Yêu cầu:{" "}
          {
            (
              {
                join: "Thêm tôi vào buổi",
                leave: "Rút khỏi buổi",
                weight: "Đổi hệ số",
                collector_nomination: "Đề cử người tính tiền",
              } as Record<string, string>
            )[text(body.kind)]
          }
          {request.data.member_id ? ` · ${name(request.data.member_id)}` : ""}
          {request.data.weight ? ` · Hệ số ${text(request.data.weight)}` : ""}
          <br />
          Lý do: {text(request.data.reason)}
        </p>
      )}
      {!!body.reason && <p>Lý do: {text(body.reason)}</p>}
      {!!body.note_text && <p>Ghi chú: {text(body.note_text)}</p>}
      {command === "create_session" &&
        z.array(z.record(z.string(), z.unknown())).safeParse(body.extras)
          .success &&
        (body.extras as Record<string, unknown>[]).map((extra, i) => (
          <AIDraftReview
            key={i}
            command="expense"
            body={extra}
            members={members}
            review={null}
            payment={null}
          />
        ))}
      {options.success && (
        <>
          <p>
            Tối thiểu: {String(body.minimum)} người · Đóng lúc{" "}
            {time(body.deadline)}
          </p>
          <ul>
            {options.data.map((o, i) => (
              <li key={i}>
                {time(o.starts_at)} — {time(o.ends_at)}
              </li>
            ))}
          </ul>
        </>
      )}
      {review && (
        <>
          <h3>Phần chịu trước và sau</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="ai-review-table">
              <thead>
                <tr>
                  <th>Thành viên</th>
                  <th>Hiện tại</th>
                  <th>Sau thay đổi</th>
                  <th>Chênh lệch</th>
                </tr>
              </thead>
              <tbody>
                {review.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{name(r.id)}</td>
                    <td>{formatMoney(r.before)}</td>
                    <td>{formatMoney(r.after)}</td>
                    <td>
                      {BigInt(r.delta) > 0n ? "+" : ""}
                      {formatMoney(r.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Cần chuyển sau thay đổi</h3>
          {review.transfers.length ? (
            review.transfers.map((t) => (
              <p key={t.from + t.to}>
                {name(t.from)} → {name(t.to)}:{" "}
                <strong>{formatMoney(t.amount)}</strong>
              </p>
            ))
          ) : (
            <p>Không còn khoản cần chuyển.</p>
          )}
          <p>Các khoản đã xác nhận được giữ nguyên trong phép tính.</p>
        </>
      )}
    </section>
  );
}
