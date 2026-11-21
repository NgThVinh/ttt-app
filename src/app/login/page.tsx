import { appName } from "@/lib/config";
import Link from "next/link";
import { login, googleLogin } from "../actions";
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
          <button className="primary full">Tiếp tục với Google</button>
        </form>
        <div className="divider">hoặc dùng email</div>
        <form action={login}>
          <label htmlFor="email">Email của bạn</label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="ban@gmail.com"
            required
          />
          <button className="secondary full">Gửi link đăng nhập</button>
        </form>
        {p.sent && (
          <p role="status">Đã gửi link. Hãy kiểm tra hộp thư của bạn.</p>
        )}
        {p.error && (
          <p role="alert">
            Chưa đăng nhập được. Kiểm tra cấu hình đăng nhập hoặc thử lại.
          </p>
        )}
        <small>Đăng nhập bằng liên kết bảo mật, không cần nhớ mật khẩu.</small>
      </section>
    </main>
  );
}
