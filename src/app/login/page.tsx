import { appName } from "@/lib/config";
import Link from "next/link";
import { login, googleLogin } from "../actions";
import { safeReturnPath } from "@/lib/auth-redirect";
import { authErrorMessage } from "@/lib/auth-errors";
import LoginButton from "@/components/login-button";
import { localDevelopmentEnabled } from "@/lib/local-development";
import { localAccounts } from "@/lib/local-development-config.mjs";
import { localLogin } from "../local-actions";
export const metadata = { title: "Đăng nhập" };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const p = await searchParams;
  const local = localDevelopmentEnabled();
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
        {local ? (
          <section
            className="local-login-options"
            aria-label="Tài khoản thử local"
          >
            <h2>Supabase local · Dữ liệu riêng</h2>
            <p>
              Chọn một tài khoản để thử tạo lịch, mời bạn và chia tiền. Nhóm
              chơi thử đã có An, Bình và Chi.
            </p>
            <div className="local-login-grid">
              {localAccounts.map((account) => (
                <form action={localLogin} key={account.id}>
                  <input type="hidden" name="account" value={account.id} />
                  <input
                    type="hidden"
                    name="next"
                    value={safeReturnPath(p.next)}
                  />
                  <LoginButton
                    className="secondary full"
                    pendingLabel="Đang vào local…"
                  >
                    {account.label}
                  </LoginButton>
                </form>
              ))}
            </div>
            <p>
              <a
                href="http://127.0.0.1:54324"
                target="_blank"
                rel="noopener noreferrer"
              >
                Mở hộp thư local
              </a>{" "}
              nếu muốn thử link đăng nhập bằng email.
            </p>
          </section>
        ) : (
          <form action={googleLogin}>
            <input type="hidden" name="next" value={safeReturnPath(p.next)} />
            <LoginButton
              className="primary full"
              pendingLabel="Đang mở Google…"
            >
              Tiếp tục với Google
            </LoginButton>
          </form>
        )}
        <div className="divider">
          {local ? "hoặc thử link email qua hộp thư local" : "hoặc dùng email"}
        </div>
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
