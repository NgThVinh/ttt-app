import ActionForm from "./action-form";
import { decideClaim } from "@/app/groups/actions";
export default function MemberClaimReview({
  reviews,
  members,
}: {
  reviews: {
    id: string;
    member_id: string;
    email: string | null;
    email_verified: boolean;
  }[];
  members: { id: string; display_name: string }[];
}) {
  if (!reviews.length) return null;
  return (
    <section
      className="panel claim-panel"
      aria-labelledby={`claim-review-${reviews[0].id}`}
    >
      <h2 id={`claim-review-${reviews[0].id}`}>
        Chờ admin xác minh thành viên
      </h2>
      {reviews.map((r) => (
        <article className="session-row" key={r.id}>
          <div>
            <p>
              <span className="claim-review-email">
                {r.email || "Chưa có email"}
              </span>{" "}
              muốn nhận lại{" "}
              <strong>
                {members.find((m) => m.id === r.member_id)?.display_name ||
                  "thành viên cũ"}
              </strong>
              .
            </p>
            <p>
              {r.email_verified
                ? "Email đã xác nhận. Hãy hỏi trực tiếp người đó trước khi duyệt; lịch sử tiền sẽ được liên kết vào tài khoản này."
                : "Email chưa xác nhận. Chưa thể đồng ý liên kết."}
            </p>
            <ActionForm action={decideClaim} label="Xử lý yêu cầu">
              <input type="hidden" name="id" value={r.id} />
              <label htmlFor={`decision-${r.id}`}>Quyết định xác minh</label>
              <select id={`decision-${r.id}`} name="decision">
                <option value="reject">Từ chối</option>
                <option value="approve" disabled={!r.email_verified}>
                  Đã xác minh — đồng ý liên kết
                </option>
              </select>
            </ActionForm>
          </div>
        </article>
      ))}
    </section>
  );
}
