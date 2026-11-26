import Link from "@/components/app-link";
import { Mail, ArrowLeft } from "lucide-react";
import { login, register, googleLogin } from "@/app/actions";
import { localLogin } from "@/app/local-actions";
import { safeReturnPath } from "@/lib/auth-redirect";
import { authErrorMessage } from "@/lib/auth-errors";
import { localDevelopmentEnabled } from "@/lib/local-development";
import { localAccounts } from "@/lib/local-development-config.mjs";
import LoginButton from "./login-button";
import BrandMark from "./brand-mark";
export default function AuthPage({
  mode,
  params,
}: {
  mode: "login" | "register";
  params: Record<string, string | string[] | undefined>;
}) {
  const signup = mode === "register",
    next = safeReturnPath(params.next);
  const suffix = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  const local = localDevelopmentEnabled(),
    sent = params.sent === "1";
  return (
    <main className="auth-page">
      <Link
        className="auth-brand"
        href="/login"
        aria-label="3T · Thích Tính Tiền"
      >
        <BrandMark size={52} />
      </Link>
      <section className="login-card auth-card" aria-labelledby="auth-title">
        {sent ? (
          <>
            <Mail size={28} className="auth-mail-icon" aria-hidden="true" />
            <h1 id="auth-title">Kiểm tra email của bạn</h1>
            <p role="status">
              {signup
                ? "Mở link trong email để hoàn tất đăng ký."
                : "Nếu email này đã có tài khoản, bạn sẽ nhận được link đăng nhập."}
            </p>
            <p>Dùng cùng trình duyệt và kiểm tra cả thư rác.</p>
            {next !== "/" && (
              <p className="auth-context">
                Bạn sẽ quay lại lời mời sau khi xác nhận.
              </p>
            )}
            {local && (
              <a
                className="primary full"
                href="http://127.0.0.1:54324"
                target="_blank"
                rel="noopener noreferrer"
              >
                Mở hộp thư local
              </a>
            )}
            <Link className="auth-back" href={`/${mode}${suffix}`}>
              <ArrowLeft size={16} aria-hidden="true" /> Dùng email khác hoặc
              gửi lại
            </Link>
          </>
        ) : (
          <>
            <h1 id="auth-title">
              {signup ? "Tạo tài khoản 3T" : "Đăng nhập vào 3T"}
            </h1>
            {next !== "/" && (
              <p className="auth-context">
                {signup
                  ? "Đăng ký để tiếp tục lời mời vào nhóm."
                  : "Đăng nhập để tiếp tục lời mời vào nhóm."}
              </p>
            )}
            {!local && (
              <>
                <form action={googleLogin}>
                  <input type="hidden" name="next" value={next} />
                  <input type="hidden" name="mode" value={mode} />
                  <LoginButton
                    className="secondary full auth-google"
                    pendingLabel="Đang mở Google…"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      aria-hidden="true"
                    >
                      <path
                        fill="currentColor"
                        d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.4ZM12 22c2.7 0 5-.9 6.6-2.4L15.4 17c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22ZM6.4 13.8a6 6 0 0 1 0-3.6V7.6H3.1a10 10 0 0 0 0 8.8l3.3-2.6ZM12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.9 5.6l3.3 2.6C7.2 7.8 9.4 6 12 6Z"
                      />
                    </svg>
                    {signup ? "Đăng ký với Google" : "Tiếp tục với Google"}
                  </LoginButton>
                </form>
                <div className="divider">hoặc dùng email</div>
              </>
            )}
            <form action={signup ? register : login}>
              <input type="hidden" name="next" value={next} />
              <label htmlFor="email">Địa chỉ email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="ban@gmail.com"
                required
                maxLength={254}
              />
              <LoginButton
                className="primary full"
                pendingLabel="Đang gửi email…"
              >
                {signup ? "Đăng ký bằng email" : "Gửi link đăng nhập"}
              </LoginButton>
            </form>
            <p className="auth-hint">Không cần mật khẩu.</p>
            {params.error && (
              <p role="alert">{authErrorMessage(params.error)}</p>
            )}
          </>
        )}
        <p className="auth-switch">
          {signup ? "Đã có tài khoản?" : "Chưa có tài khoản?"}{" "}
          <Link href={`${signup ? "/login" : "/register"}${suffix}`}>
            {signup ? "Đăng nhập" : "Đăng ký"}
          </Link>
        </p>
        {signup && <p className="auth-note">Tham gia nhóm bằng link mời.</p>}
      </section>
      {local && (
        <section
          className="local-login-options auth-local"
          aria-label="Tài khoản thử local"
        >
          <h2>Supabase local · Dữ liệu riêng</h2>
          <p>Chọn tài khoản để thử trên máy này.</p>
          <div className="local-login-grid">
            {localAccounts.map((account) => (
              <form action={localLogin} key={account.id}>
                <input type="hidden" name="account" value={account.id} />
                <input type="hidden" name="next" value={next} />
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
            Để thử đăng ký bằng email, dùng email khác và mở{" "}
            <a
              href="http://127.0.0.1:54324"
              target="_blank"
              rel="noopener noreferrer"
            >
              hộp thư local
            </a>
            .
          </p>
        </section>
      )}
    </main>
  );
}
