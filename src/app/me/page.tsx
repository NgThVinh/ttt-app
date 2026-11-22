import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { logout } from "@/app/actions";
import ActionForm from "@/components/action-form";
import { saveProfile } from "@/app/groups/actions";
import PushSettings from "@/components/push-settings";
import InstallApp from "@/components/install-app";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
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
      <Card className="my-5 border-[var(--line)]">
        <CardHeader>
          <CardTitle>
            <h2>Thông tin cá nhân và nhận tiền</h2>
          </CardTitle>
          <CardDescription>
            Tên hiển thị giúp bạn bè nhận ra bạn trong nhóm.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveProfile}>
            <label htmlFor="display_name">Tên hiển thị</label>
            <Input
              id="display_name"
              name="display_name"
              required
              maxLength={100}
              defaultValue={p?.display_name || ""}
            />
            <p>
              Chỉ người nhận tiền cần điền ngân hàng. Thông tin này không được
              đưa vào chat AI.
            </p>
            <label htmlFor="bank_bin">Mã BIN ngân hàng (6 số)</label>
            <Input
              id="bank_bin"
              name="bank_bin"
              inputMode="numeric"
              maxLength={6}
              defaultValue={p?.bank_bin || ""}
            />
            <label htmlFor="bank_account_no">Số tài khoản</label>
            <Input
              id="bank_account_no"
              name="bank_account_no"
              maxLength={30}
              defaultValue={p?.bank_account_no || ""}
            />
            <label htmlFor="bank_account_name">Tên chủ tài khoản</label>
            <Input
              id="bank_account_name"
              name="bank_account_name"
              maxLength={100}
              defaultValue={p?.bank_account_name || ""}
            />
          </ActionForm>
        </CardContent>
      </Card>
      <InstallApp />
      <section className="panel">
        <h2>Tiện ích nhóm</h2>
        <div className="actions">
          <Link href="/ai">Trợ lý 3T</Link>
          <Link href="/polls">Hẹn lịch</Link>
          <Link href="/approvals">Chờ tôi duyệt</Link>
        </div>
      </section>
      <PushSettings />
      <form action={logout}>
        <Button variant="outline">Đăng xuất</Button>
      </form>
    </main>
  );
}
