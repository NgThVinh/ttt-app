import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { logout } from "@/app/actions";
import ActionForm from "@/components/action-form";
import { saveProfile } from "@/app/groups/actions";
import PushSettings from "@/components/push-settings";
import InstallApp from "@/components/install-app";
export default async function Me() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: p, error } = await db
    .from("profiles")
    .select("display_name,bank_bin,bank_account_no,bank_account_name")
    .eq("id", user.id)
    .maybeSingle();
  return (
    <main>
      <Link href="/">Về trang chủ</Link>
      <h1>Hồ sơ của tôi</h1>
      {error && (
        <p role="alert">Chưa tải được hồ sơ. Kiểm tra migration và kết nối.</p>
      )}
      <section className="panel">
        <ActionForm action={saveProfile}>
          <label htmlFor="display_name">Tên hiển thị</label>
          <input
            id="display_name"
            name="display_name"
            required
            maxLength={100}
            defaultValue={p?.display_name || ""}
          />
          <p>
            Chỉ người nhận tiền cần điền ngân hàng. Thông tin này không được đưa
            vào chat AI.
          </p>
          <label htmlFor="bank_bin">Mã BIN ngân hàng (6 số)</label>
          <input
            id="bank_bin"
            name="bank_bin"
            inputMode="numeric"
            maxLength={6}
            defaultValue={p?.bank_bin || ""}
          />
          <label htmlFor="bank_account_no">Số tài khoản</label>
          <input
            id="bank_account_no"
            name="bank_account_no"
            maxLength={30}
            defaultValue={p?.bank_account_no || ""}
          />
          <label htmlFor="bank_account_name">Tên chủ tài khoản</label>
          <input
            id="bank_account_name"
            name="bank_account_name"
            maxLength={100}
            defaultValue={p?.bank_account_name || ""}
          />
        </ActionForm>
      </section>
      <InstallApp />
      <PushSettings />
      <form action={logout}>
        <button className="secondary">Đăng xuất</button>
      </form>
    </main>
  );
}
