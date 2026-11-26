import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import ActionForm from "@/components/action-form";
import { decideDraft } from "./actions";
import AIDraftReview from "@/components/ai-draft-review";
import { expenseReview } from "@/lib/ai/harness/expense-review";
import { detailSchema } from "@/lib/session-data";
import { draftStatusLabels } from "@/lib/ai/draft-labels";
export default async function Draft({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await supabase(),
    {
      data: { user },
    } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: d } = await db
    .from("ai_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!d) notFound();
  const { data: members } = await db
    .from("group_members")
    .select("id,user_id,display_name")
    .eq("group_id", d.group_id);
  const body = z.record(z.string(), z.unknown()).parse(d.body);
  const detail = d.session_id
    ? detailSchema.safeParse(
        (await db.rpc("session_details", { sid: d.session_id })).data,
      )
    : null;
  let review: ReturnType<typeof expenseReview> | null = null;
  let reviewError = false;
  if (d.command === "expense") {
    try {
      if (!detail?.success) throw Error("No session");
      const { data: court } = await db
        .from("expenses")
        .select("id")
        .eq("session_id", d.session_id)
        .eq("kind", "court")
        .eq("status", "active")
        .maybeSingle();
      review = expenseReview(detail.data, body, court?.id || null);
    } catch {
      reviewError = true;
    }
  }
  const payments = z
    .array(
      z.object({
        id: z.uuid(),
        from_name: z.string(),
        to_name: z.string(),
        amount: z.string(),
        ref_code: z.string(),
      }),
    )
    .safeParse((await db.rpc("my_settlements")).data);
  const payment = payments.success
    ? payments.data.find((p) => p.id === body.target) || null
    : null;
  const current =
    d.status === "pending" &&
    new Date(d.expires_at).getTime() > new Date().getTime() &&
    (!d.session_id ||
      (detail?.success &&
        String(detail.data.revision) === String(d.session_revision)));
  return (
    <main>
      <Link href="/ai">Trợ lý AI</Link>
      <h1>Xác nhận bản nháp</h1>
      <p>
        {d.status === "pending" && !current
          ? "Cần tạo bản mới"
          : draftStatusLabels[d.status] || "Đã kết thúc"}{" "}
        · Hết hạn{" "}
        {new Date(d.expires_at).toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
        })}
      </p>
      <p>
        Người gửi:{" "}
        {members?.find((m) => m.user_id === d.requested_by)?.display_name ||
          "Thành viên"}{" "}
        · Người duyệt:{" "}
        {members?.find((m) => m.user_id === d.authority_id)?.display_name ||
          "Thành viên"}
      </p>
      {d.session_id && (
        <Link href={`/sessions/${d.session_id}`}>
          Xem buổi và bảng chia hiện tại
        </Link>
      )}
      <AIDraftReview
        command={d.command}
        body={body}
        members={members || []}
        review={review}
        payment={payment}
      />
      {reviewError && (
        <p role="alert">
          Chưa tính được bảng chênh lệch. Tạo bản nháp mới trước khi duyệt.
        </p>
      )}
      {!current && d.status === "pending" && (
        <p role="alert">
          Bản nháp đã hết hạn hoặc buổi đã thay đổi. Cần tạo bản mới.
        </p>
      )}
      {d.command === "confirm_received" && (
        <p>
          Kiểm tra đúng mã và số tiền trong sao kê trước khi xác nhận đã nhận.
        </p>
      )}
      {current && d.authority_id === user.id && (
        <ActionForm action={decideDraft} label="Gửi quyết định">
          <input type="hidden" name="id" value={d.id} />
          <input type="hidden" name="hash" value={d.payload_hash} />
          <label>
            Quyết định
            <select name="decision">
              <option value="approve" disabled={reviewError}>
                Đồng ý thực hiện
              </option>
              <option value="reject">Từ chối</option>
            </select>
          </label>
          <label>
            <input type="checkbox" name="reviewed" value="yes" />
            Tôi đã xem chính xác nội dung và bảng chia hiện tại
          </label>
        </ActionForm>
      )}
    </main>
  );
}
export const metadata = { title: "Xem bản nháp" };
