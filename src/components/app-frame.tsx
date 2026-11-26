"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import BrandMark from "./brand-mark";
import NotificationPreview from "./notification-preview";
import {
  Home,
  CalendarDays,
  Wallet,
  Users,
  User,
  Sparkles,
  CheckCheck,
  FileClock,
  Moon,
  Sun,
} from "lucide-react";
const navigationLinks = [
  { href: "/", label: "Trang chủ", icon: Home },
  { href: "/sessions", label: "Buổi chơi", icon: CalendarDays },
  { href: "/debts", label: "Công nợ", icon: Wallet },
  { href: "/groups", label: "Nhóm", icon: Users },
  { href: "/approvals", label: "Yêu cầu", icon: CheckCheck },
  { href: "/ai", label: "Trợ lý 3T", icon: Sparkles },
  { href: "/me", label: "Tôi", icon: User },
];
function subscribeTheme(listener: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("3t-theme", listener);
  window.addEventListener("storage", listener);
  media.addEventListener("change", listener);
  return () => {
    window.removeEventListener("3t-theme", listener);
    window.removeEventListener("storage", listener);
    media.removeEventListener("change", listener);
  };
}
function currentTheme() {
  try {
    const saved = localStorage.getItem("3t-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {}
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
export default function AppFrame({
  children,
  localDevelopment = false,
}: {
  children: React.ReactNode;
  localDevelopment?: boolean;
}) {
  const path = usePathname();
  const [canAudit, setCanAudit] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/navigation", { signal: controller.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { canAudit: false }))
      .then((v) => setCanAudit(v.canAudit === true))
      .catch(() => {
        if (!controller.signal.aborted) setCanAudit(false);
      });
    return () => controller.abort();
  }, [path]);
  const mainLinks = canAudit
    ? [
        ...navigationLinks.slice(0, -1),
        { href: "/audit", label: "Nhật ký", icon: FileClock },
        navigationLinks.at(-1)!,
      ]
    : navigationLinks;
  const theme = useSyncExternalStore(
    subscribeTheme,
    currentTheme,
    () => "light",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.getElementById("main-content")?.scrollTo({ top: 0 });
  }, [path]);
  function toggleTheme() {
    try {
      localStorage.setItem("3t-theme", theme === "dark" ? "light" : "dark");
    } catch {
      return;
    }
    window.dispatchEvent(new Event("3t-theme"));
  }
  if (
    path === "/login" ||
    path === "/register" ||
    path === "/welcome" ||
    path.startsWith("/join/")
  )
    return <>{children}</>;
  const active = (href: string) =>
    href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
  const title =
    mainLinks.find((link) => active(link.href))?.label || "Không gian của bạn";
  return (
    <div
      className="app-frame"
      data-workspace={path === "/sessions" ? "calendar" : "page"}
    >
      <a className="skip-link" href="#main-content">
        Đến nội dung chính
      </a>
      <aside className="app-sidebar">
        <Link href="/" className="app-brand" aria-label="3T · Trang chủ">
          <BrandMark />
        </Link>
        <nav aria-label="Điều hướng chính">
          {mainLinks.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
            >
              <Icon size={20} />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="app-content">
        <header className="app-header">
          <Link href="/" className="mobile-brand" aria-label="3T · Trang chủ">
            <BrandMark size={36} />
          </Link>
          <span className="app-breadcrumb">
            <strong>{title}</strong>
          </span>
          {localDevelopment && (
            <Link
              className="local-development-badge"
              href="/login"
              title="Supabase chạy trên máy, dữ liệu thử riêng"
            >
              Local · Đổi vai
            </Link>
          )}
          <div className="app-header-actions">
            <button
              type="button"
              aria-label={
                theme === "dark" ? "Bật giao diện sáng" : "Bật giao diện tối"
              }
              onClick={toggleTheme}
            >
              <span
                className="t-icon-swap"
                data-state={theme === "dark" ? "b" : "a"}
                aria-hidden="true"
              >
                <span className="t-icon" data-icon="a">
                  <Moon size={20} />
                </span>
                <span className="t-icon" data-icon="b">
                  <Sun size={20} />
                </span>
              </span>
            </button>
            <NotificationPreview key={path} />
          </div>
        </header>
        <div id="main-content" tabIndex={-1} data-scroll="workspace">
          {children}
        </div>
      </div>
      <nav
        className="app-bottom-nav"
        aria-label="Điều hướng điện thoại"
        style={{
          gridTemplateColumns: `repeat(${mainLinks.length},minmax(0,1fr))`,
        }}
      >
        {mainLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? "page" : undefined}
          >
            <Icon size={21} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
