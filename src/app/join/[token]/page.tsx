import { notFound, redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ActionForm from "@/components/action-form";
import { acceptInvite } from "@/app/groups/actions";
import { z } from "zod";
export default async function Join({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { token } = await params;
  const candidate = z.uuid().safeParse((await searchParams).session);
  const sessionId = candidate.success ? candidate.data : "";
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    redirect(
      "/login?next=" +
        encodeURIComponent(
          `/join/${token}${sessionId ? `?session=${sessionId}` : ""}`,
        ),
    );
  return (
    <main>
      <section className="login-card">
        <h1>Vào nhóm cùng bạn bè</h1>
        <p>
          Link mời được kiểm tra khi bạn xác nhận. Tham gia bằng tên mới; admin
          sẽ hỗ trợ liên kết thành viên đã có sau.
        </p>
        <ActionForm action={acceptInvite} label="Tham gia nhóm">
          <input type="hidden" name="token" value={token} />
          {sessionId && (
            <>
              <input type="hidden" name="session_id" value={sessionId} />
              <p>
                Vào nhóm xong, bạn sẽ xem buổi được mời và tự chọn tham gia.
                Chưa phát sinh phần tiền ở bước này.
              </p>
            </>
          )}
          <label htmlFor="name">Tên trong nhóm</label>
          <input
            id="name"
            name="name"
            required
            maxLength={100}
            defaultValue={
              typeof user.user_metadata.full_name === "string"
                ? user.user_metadata.full_name
                : ""
            }
          />
        </ActionForm>
      </section>
    </main>
  );
}
export const metadata = { title: "Lời mời vào nhóm" };
