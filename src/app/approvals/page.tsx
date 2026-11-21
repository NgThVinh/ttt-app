import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ApprovalCard from "@/components/approval-card";
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
  const [{ data, error }, { data: members }] = await Promise.all([
    db
      .from("approval_requests")
      .select(
        "id,session_id,type,payload_hash,payload,requested_by,required_authority,expires_at,status,source",
      )
      .not("session_id", "is", null)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at"),
    db.from("group_members").select("id,user_id,display_name,status"),
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
  return (
    <main>
      <Link href="/">Trang chủ</Link>
      <h1>Chờ tôi duyệt và yêu cầu đã gửi</h1>
      {(error || !parsed.success) && <p role="alert">Chưa tải được yêu cầu.</p>}
      {!error && parsed.success && !requests.length && (
        <p>Chưa có yêu cầu còn hạn đang chờ bạn.</p>
      )}
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
