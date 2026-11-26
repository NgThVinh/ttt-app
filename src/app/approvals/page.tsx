import Link from "@/components/app-link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ApprovalCard from "@/components/approval-card";
import MemberClaimReview from "@/components/member-claim-review";
import { z } from "zod";
const schema = z.array(
  z.object({
    id: z.uuid(),
    session_id: z.uuid(),
    type: z.string(),
    payload_hash: z.string(),
    payload: z.record(z.string(), z.unknown()),
    requested_by: z.uuid(),
    required_authority: z.string(),
    expires_at: z.string(),
    status: z.string(),
    source: z.string(),
  }),
);
export default async function Approvals() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const [
    { data, error },
    { data: members },
    { data: ownClaims, error: claimError },
    { data: groups },
  ] = await Promise.all([
    db
      .from("approval_requests")
      .select(
        "id,session_id,type,payload_hash,payload,requested_by,required_authority,expires_at,status,source",
      )
      .not("session_id", "is", null)
      .eq("status", "pending")
      .neq("type", "admin_fallback")
      .gt("expires_at", new Date().toISOString())
      .order("created_at"),
    db
      .from("group_members")
      .select("id,user_id,display_name,status,group_id,role"),
    db
      .from("approval_requests")
      .select("id,group_id,expires_at")
      .eq("type", "member_claim")
      .eq("requested_by", user.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString()),
    db.from("groups").select("id,name"),
  ]);
  const parsed = schema.safeParse(data);
  const mine = new Set(
    members
      ?.filter((m) => m.user_id === user.id && m.status === "active")
      .map((m) => m.id),
  );
  const requests = parsed.success
    ? parsed.data.filter(
        (r) => mine.has(r.required_authority) || r.requested_by === user.id,
      )
    : [];
  const adminGroups = [
    ...new Set(
      members
        ?.filter(
          (m) =>
            m.user_id === user.id &&
            m.status === "active" &&
            m.role === "admin",
        )
        .map((m) => m.group_id),
    ),
  ];
  const claimSchema = z.array(
    z.object({
      id: z.uuid(),
      member_id: z.uuid(),
      email: z.string().nullable(),
      email_verified: z.boolean(),
    }),
  );
  const claimReviews = await Promise.all(
    adminGroups.map(async (g) => {
      const { data, error } = await db.rpc("member_claim_reviews", { g });
      const parsed = claimSchema.safeParse(data);
      return {
        groupId: g,
        reviews: parsed.success ? parsed.data : [],
        error: !!error || !parsed.success,
      };
    }),
  );
  const hasClaims = claimReviews.some((g) => g.reviews.length);
  return (
    <main>
      <Link href="/">Trang chủ</Link>
      <h1>Yêu cầu</h1>
      {(error || !parsed.success) && <p role="alert">Chưa tải được yêu cầu.</p>}
      {!error &&
        !claimError &&
        parsed.success &&
        !requests.length &&
        !hasClaims &&
        !ownClaims?.length && <p>Không có yêu cầu đang chờ.</p>}
      {claimError && <p role="alert">Chưa tải được yêu cầu liên kết đã gửi.</p>}
      {!!ownClaims?.length && (
        <section className="panel">
          <h2>Yêu cầu liên kết đã gửi</h2>
          {ownClaims.map((r) => (
            <p key={r.id}>
              <Link href={`/groups/${r.group_id}#link-account`}>
                {groups?.find((g) => g.id === r.group_id)?.name || "Mở nhóm"}
              </Link>{" "}
              · Chờ admin xác minh.{" "}
              <small>
                Hết hạn{" "}
                {new Date(r.expires_at).toLocaleString("vi-VN", {
                  timeZone: "Asia/Ho_Chi_Minh",
                })}
                .
              </small>
            </p>
          ))}
        </section>
      )}
      {claimReviews.map((g) => (
        <div key={g.groupId}>
          {g.error && (
            <p role="alert">
              Chưa tải được yêu cầu liên kết tài khoản.{" "}
              <Link href={`/groups/${g.groupId}`}>Mở nhóm</Link>
            </p>
          )}
          {!!g.reviews.length && (
            <>
              <Link href={`/groups/${g.groupId}`}>
                {groups?.find((group) => group.id === g.groupId)?.name ||
                  "Xem nhóm liên quan"}
              </Link>
              <MemberClaimReview reviews={g.reviews} members={members || []} />
            </>
          )}
        </div>
      ))}
      {requests.map((r) => (
        <div key={r.id}>
          <Link href={`/sessions/${r.session_id}`}>Xem buổi liên quan</Link>
          <ApprovalCard
            key={r.id + r.payload_hash}
            request={r}
            canDecide={mine.has(r.required_authority)}
            canCancel={r.requested_by === user.id}
            summary={`${members?.find((m) => m.user_id === r.requested_by)?.display_name || "Thành viên"} gửi yêu cầu${typeof r.payload.member_id === "string" ? ` cho ${members?.find((m) => m.id === r.payload.member_id)?.display_name || "thành viên trong buổi"}` : ""}`}
          />
        </div>
      ))}
    </main>
  );
}
export const metadata = { title: "Yêu cầu" };
