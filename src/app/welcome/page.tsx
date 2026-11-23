import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { logout } from "@/app/actions";
import { verifiedSuperAdmin } from "@/lib/super-admin-access";
export default async function Welcome() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const membership = await db
    .from("group_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1);
  if (!membership.error && membership.data?.length) redirect("/");
  if (!membership.error && (await verifiedSuperAdmin(db))) redirect("/groups");
  return (
    <main className="welcome-page">
      <div className="welcome-brand" aria-label="3T · Thích Tính Tiền">
        3T
      </div>
      <section>
        <h1>Chờ lời mời từ nhóm bạn</h1>
        <p>
          Nhờ quản trị viên gửi link mời, rồi mở link để tham gia nhóm. Sau đó
          bạn có thể xem lịch chơi và chia tiền cùng mọi người.
        </p>
        {membership.error && (
          <p role="alert">
            Chưa kiểm tra được nhóm của bạn. Vui lòng tải lại trang.
          </p>
        )}
        <p className="welcome-account">Đã đăng nhập: {user.email}</p>
        <form action={logout}>
          <button className="secondary">Đăng xuất</button>
        </form>
      </section>
    </main>
  );
}
