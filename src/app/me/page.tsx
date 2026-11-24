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
import { profileName } from "@/lib/profile-name";
import BankPicker from "@/components/bank-picker";
import { localDevelopmentEnabled } from "@/lib/local-development";
export const metadata = { title: "Hồ sơ của tôi" };
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
  const { data: memberships } = await db
    .from("group_members")
    .select("group_id,display_name")
    .eq("user_id", user.id)
    .eq("status", "active");
  const { data: groups } = await db.from("groups").select("id,name");
  return (
    <main>
      <Link href="/">Về trang chủ</Link>
      <h1>Hồ sơ của tôi</h1>
      <section className="panel" aria-labelledby="account-title">
        <h2 id="account-title">Tài khoản đăng nhập</h2>
        <div className="account-summary">
          <p>
            <strong>{user.email}</strong>
          </p>
          <small>
            {user.email_confirmed_at
              ? "Email đã xác nhận"
              : "Email chưa xác nhận"}
          </small>
        </div>
        {localDevelopmentEnabled() &&
          user.email?.endsWith("@local.3t.test") && (
            <p>
              Đây là tài khoản thử local. Để dùng email của bạn, đăng xuất rồi
              đăng ký tài khoản riêng và mở link mời.
            </p>
          )}
        <details>
          <summary>Nhận lại tên đã được thêm hộ</summary>
          <p>
            Vào nhóm, chọn tên cũ và gửi yêu cầu liên kết. Admin xác minh xong,
            tài khoản này giữ toàn bộ lịch chơi và khoản tiền của tên đó.
          </p>
          <div className="actions">
            {memberships?.map((m) => (
              <Link
                key={m.group_id}
                href={`/groups/${m.group_id}#link-account`}
              >
                {groups?.find((g) => g.id === m.group_id)?.name ||
                  m.display_name}
              </Link>
            ))}
          </div>
        </details>
      </section>
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
              defaultValue={profileName(p?.display_name, user.user_metadata)}
            />
            <p>
              Chỉ người nhận tiền cần điền ngân hàng. Thông tin này không được
              đưa vào chat AI.
            </p>
            <BankPicker id="profile-bank" defaultValue={p?.bank_bin || ""} />
            <div className="compact-fields profile-bank-fields">
              <div>
                <label htmlFor="bank_account_no">Số tài khoản</label>
                <Input
                  id="bank_account_no"
                  name="bank_account_no"
                  inputMode="numeric"
                  maxLength={30}
                  defaultValue={p?.bank_account_no || ""}
                />
              </div>
              <div>
                <label htmlFor="bank_account_name">Tên chủ tài khoản</label>
                <Input
                  id="bank_account_name"
                  name="bank_account_name"
                  maxLength={100}
                  defaultValue={p?.bank_account_name || ""}
                />
              </div>
            </div>
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
