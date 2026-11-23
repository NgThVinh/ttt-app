import { appName } from "@/lib/config";
import Link from "next/link";
import { login, googleLogin } from "../actions";
import { safeReturnPath } from "@/lib/auth-redirect";
import { authErrorMessage } from "@/lib/auth-errors";
import LoginButton from "@/components/login-button";
export const metadata = { title: "Đăng nhập" };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const p = await searchParams;
  return (
    <main className="login">
      <Link className="brand" href="/">
        {appName}
        <span>Thích Tính Tiền</span>
      </Link>
      <section className="login-card">
        <span className="eyebrow">CHƠI VUI. CHIA GỌN.</span>
        <h1>
          Hẹn nhau ra sân.
          <br />
          Tiền nong để 3T lo.
        </h1>
        <p>Một chỗ cho lịch chơi, chia tiền và những khoản cần nhớ.</p>
        <form action={googleLogin}>
          <input type="hidden" name="next" value={safeReturnPath(p.next)} />
          <LoginButton className="primary full" pendingLabel="Đang mở Google…">
            Tiếp tục với Google
          </LoginButton>
        </form>
        <div className="divider">hoặc dùng email</div>
        <form action={login}>
          <input type="hidden" name="next" value={safeReturnPath(p.next)} />
          <label htmlFor="email">Email của bạn</label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="ban@gmail.com"
            required
          />
          <LoginButton className="secondary full" pendingLabel="Đang gửi link…">
            Gửi link đăng nhập
          </LoginButton>
        </form>
        {p.sent && (
          <p role="status">Đã gửi link. Hãy kiểm tra hộp thư của bạn.</p>
        )}
        {p.error && <p role="alert">{authErrorMessage(p.error)}</p>}
        <small>Đăng nhập bằng liên kết bảo mật, không cần nhớ mật khẩu.</small>
      </section>
    </main>
  );
}
