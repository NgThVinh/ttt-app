import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import ActionForm from "@/components/action-form";
import { decideDraft } from "./actions";
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
  return (
    <main>
      <Link href="/ai">Trợ lý AI</Link>
      <h1>Xem và duyệt bản nháp AI</h1>
      <p>
        {d.tier} · {d.status} · Hết hạn{" "}
        {new Date(d.expires_at).toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
        })}
      </p>
      {d.session_id && (
        <Link href={`/sessions/${d.session_id}`}>
          Xem buổi và bảng chia hiện tại
        </Link>
      )}
      <section className="panel">
        <h2>Nội dung sẽ thực hiện</h2>
        <p>{d.command}</p>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {JSON.stringify(d.body, null, 2)}
        </pre>
        {d.preview && (
          <details>
            <summary>Bảng xem trước</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(d.preview, null, 2)}
            </pre>
          </details>
        )}
      </section>
      {d.command === "confirm_received" && (
        <p>
          Kiểm tra đúng mã và số tiền trong sao kê trước khi xác nhận đã nhận.
        </p>
      )}
      {d.status === "pending" && d.authority_id === user.id && (
        <ActionForm action={decideDraft} label="Gửi quyết định">
          <input type="hidden" name="id" value={d.id} />
          <input type="hidden" name="hash" value={d.payload_hash} />
          <label>
            Quyết định
            <select name="decision">
              <option value="approve">Đồng ý thực hiện</option>
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
