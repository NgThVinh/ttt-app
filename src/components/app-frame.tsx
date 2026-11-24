"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { AnimatedDisclosure } from "./ui/animated-disclosure";
import {
  Home,
  CalendarDays,
  Wallet,
  Users,
  User,
  Bell,
  Sparkles,
  CheckCheck,
  ChartNoAxesColumn,
  Moon,
  Sun,
} from "lucide-react";
const mainLinks = [
  { href: "/", label: "Trang chủ", icon: Home },
  { href: "/sessions", label: "Buổi chơi", icon: CalendarDays },
  { href: "/debts", label: "Công nợ", icon: Wallet },
  { href: "/groups", label: "Nhóm", icon: Users },
  { href: "/me", label: "Tôi", icon: User },
];
const otherLinks = [
  { href: "/approvals", label: "Chờ tôi duyệt", icon: CheckCheck },
  { href: "/polls", label: "Hẹn lịch", icon: ChartNoAxesColumn },
  { href: "/ai", label: "Trợ lý 3T", icon: Sparkles },
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
  if (path === "/login" || path === "/welcome" || path.startsWith("/join/"))
    return <>{children}</>;
  const active = (href: string) =>
    href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
  const title =
    [...mainLinks, ...otherLinks].find((link) => active(link.href))?.label ||
    "Không gian của bạn";
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
          <span>3T</span>
          <div>Thích Tính Tiền</div>
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
        <AnimatedDisclosure className="more-navigation" title="Thêm">
          <nav aria-label="Tiện ích nhóm">
            {otherLinks.map(({ href, label, icon: Icon }) => (
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
        </AnimatedDisclosure>
      </aside>
      <div className="app-content">
        <header className="app-header">
          <Link href="/" className="mobile-brand" aria-label="3T · Trang chủ">
            3T
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
            <Link href="/notifications" aria-label="Thông báo">
              <Bell size={20} />
            </Link>
          </div>
        </header>
        <div id="main-content" tabIndex={-1} data-scroll="workspace">
          {children}
        </div>
      </div>
      <nav className="app-bottom-nav" aria-label="Điều hướng điện thoại">
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
