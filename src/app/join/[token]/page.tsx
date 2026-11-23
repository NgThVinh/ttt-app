import { notFound, redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ActionForm from "@/components/action-form";
import { acceptInvite } from "@/app/groups/actions";
export default async function Join({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login?next=" + encodeURIComponent(`/join/${token}`));
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
