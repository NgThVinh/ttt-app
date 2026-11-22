"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  MapPin,
  Plus,
  Calculator,
  X,
  Copy,
  CheckCheck,
  Users,
  ArrowRight,
} from "lucide-react";
import { allocate, formatMoney } from "@/lib/money";
type Group = { id: string; name: string; sport: string };
type Session = {
  id: string;
  title: string;
  venue: string;
  starts_at: string;
  status: string;
};
const statusLabels: Record<string, string> = {
  planned: "Sắp diễn ra",
  played: "Đang tính tiền",
  settled: "Đã chốt",
};
function date(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}
export default function Dashboard({
  demo = false,
  name = "bạn",
  groups = [],
  sessions = [],
  setupError = false,
  summary = null,
}: {
  demo?: boolean;
  name?: string;
  groups?: Group[];
  sessions?: Session[];
  setupError?: boolean;
  summary?: {
    owe: string;
    owed: string;
    payCount: number;
    receiveCount: number;
  } | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [amount, setAmount] = useState("400000"),
    [count, setCount] = useState("8"),
    [notice, setNotice] = useState("");
  const items = demo
    ? [
        {
          id: "demo",
          title: "Cầu lông tối thứ Năm",
          venue: "Sân cầu lông Thành Công",
          starts_at: "2026-11-26T12:00:00Z",
          status: "planned",
        },
      ]
    : sessions;
  const upcoming = items
    .filter((s) => s.status === "planned")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const balance = demo
    ? { owe: "150000", owed: "280000", payCount: 2, receiveCount: 4 }
    : summary;
  const shares = (() => {
    try {
      const n = Number(count);
      if (!Number.isInteger(n) || n < 1 || n > 100 || !/^\d+$/.test(amount))
        return [];
      return allocate(
        BigInt(amount),
        Array.from({ length: n }, (_, i) => ({
          memberId: String(i).padStart(3, "0"),
          weight: 1n,
        })),
      );
    } catch {
      return [];
    }
  })();
  return (
    <main className="home-page">
      {demo && (
        <div className="demo-banner">
          <span>Bạn đang xem dữ liệu minh họa.</span>
          <Link href="/login">
            Đăng nhập để bắt đầu <ArrowUpRight size={15} />
          </Link>
        </div>
      )}
      <div className="page-heading">
        <div>
          <p className="eyebrow">MỖI BUỔI CHƠI, MỘT NIỀM VUI</p>
          <h1>
            Chào {demo ? "bạn" : name} <span aria-hidden="true">☀️</span>
          </h1>
          <p>Lịch chơi rõ ràng. Tiền nong nhẹ nhàng.</p>
        </div>
        <Link href={demo ? "/login" : "/sessions/new"} className="primary">
          <Plus size={18} />
          Tạo buổi chơi
        </Link>
      </div>
      {setupError && (
        <p role="alert">
          Chưa tải được dữ liệu. Thử tải lại trang khi có kết nối.
        </p>
      )}
      <section className="home-balances" aria-label="Tổng quan công nợ">
        <Link href={demo ? "/login" : "/debts"} className="balance-card">
          <span className="balance-label">
            <span className="balance-icon amber">
              <ArrowUpRight size={21} />
            </span>
            Tôi cần trả
          </span>
          <strong className="money">
            {balance ? formatMoney(balance.owe) : "—"}
          </strong>
          <span>
            {balance
              ? `${balance.payCount} khoản chưa hoàn tất`
              : "Chưa tải được công nợ"}
            <ArrowRight size={17} />
          </span>
        </Link>
        <Link href={demo ? "/login" : "/debts"} className="balance-card">
          <span className="balance-label">
            <span className="balance-icon teal">
              <ArrowDownLeft size={21} />
            </span>
            Tôi cần thu
          </span>
          <strong className="money">
            {balance ? formatMoney(balance.owed) : "—"}
          </strong>
          <span>
            {balance
              ? `${balance.receiveCount} khoản cần theo dõi`
              : "Chưa tải được công nợ"}
            <ArrowRight size={17} />
          </span>
        </Link>
        <button
          type="button"
          className="quick-split-card"
          onClick={() => {
            setNotice("");
            dialog.current?.showModal();
          }}
        >
          <Calculator size={26} />
          <strong>Chia thử một khoản</strong>
          <span>
            Tính nhanh trước khi tạo buổi <ArrowUpRight size={16} />
          </span>
        </button>
      </section>
      <div className="home-columns">
        <div>
          <section className="panel upcoming-panel">
            <div className="section-title">
              <h2>Hẹn tiếp theo</h2>
              <Link href={demo ? "/login" : "/sessions"}>
                Xem lịch <ArrowUpRight size={16} />
              </Link>
            </div>
            {upcoming ? (
              <>
                <span className="event-date">
                  <CalendarDays size={18} />
                  {date(upcoming.starts_at)}
                </span>
                <h3>{upcoming.title}</h3>
                <p className="venue-line">
                  <MapPin size={17} />
                  {upcoming.venue || "Chưa chọn địa điểm"}
                </p>
                <Link
                  className="primary"
                  href={demo ? "/login" : `/sessions/${upcoming.id}`}
                >
                  Xem buổi chơi <ArrowRight size={17} />
                </Link>
              </>
            ) : (
              <div className="home-empty">
                <CalendarDays size={32} />
                <h3>Chưa có lịch hẹn mới</h3>
                <p>Tạo buổi chơi hoặc thăm dò một ngày cả nhóm cùng rảnh.</p>
                <Link href="/polls" className="secondary">
                  Hẹn lịch cùng nhóm
                </Link>
              </div>
            )}
          </section>
          <section className="panel">
            <div className="section-title">
              <h2>Buổi chơi gần đây</h2>
              <Link href={demo ? "/login" : "/sessions"}>
                Tất cả <ArrowUpRight size={16} />
              </Link>
            </div>
            {!items.length && (
              <p className="empty">
                Buổi chơi đầu tiên của nhóm sẽ xuất hiện ở đây.
              </p>
            )}
            {items.slice(0, 5).map((s) => (
              <Link
                className="home-session"
                key={s.id}
                href={demo ? "/login" : `/sessions/${s.id}`}
              >
                <span className="home-session-icon">
                  <CalendarDays size={21} />
                </span>
                <span>
                  <strong>{s.title}</strong>
                  <small>{date(s.starts_at)}</small>
                </span>
                <span
                  className={`status-pill ${s.status === "settled" ? "settled" : ""}`}
                >
                  {statusLabels[s.status] || s.status}
                </span>
                <ArrowUpRight size={16} />
              </Link>
            ))}
          </section>
        </div>
        <div>
          <section className="panel home-next">
            <span className="eyebrow">DÀNH CHO BẠN</span>
            <h2>Việc cần nhớ</h2>
            <Link href={demo ? "/login" : "/approvals"}>
              <CheckCheck size={22} />
              <span>
                <strong>Chờ tôi duyệt</strong>
                <small>Xem đề xuất và khoản cần xác nhận</small>
              </span>
              <ArrowUpRight size={17} />
            </Link>
            <Link href={demo ? "/login" : "/polls"}>
              <CalendarDays size={22} />
              <span>
                <strong>Hẹn buổi tiếp theo</strong>
                <small>Cùng chọn một lịch cả nhóm rảnh</small>
              </span>
              <ArrowUpRight size={17} />
            </Link>
          </section>
          <section className="panel">
            <div className="section-title">
              <h2>Nhóm của tôi</h2>
              <Link
                href={demo ? "/login" : "/groups"}
                aria-label="Xem các nhóm"
              >
                <ArrowUpRight size={18} />
              </Link>
            </div>
            {!groups.length ? (
              <p>
                {demo
                  ? "Đăng nhập để tham gia nhóm bạn của mình."
                  : "Bạn chưa có nhóm. Mở link mời để tham gia cùng bạn bè."}
              </p>
            ) : (
              groups.map((g) => (
                <Link
                  className="home-group"
                  key={g.id}
                  href={`/groups/${g.id}`}
                >
                  <Users size={20} />
                  <span>
                    {g.name}
                    <small>{g.sport}</small>
                  </span>
                  <ArrowRight size={17} />
                </Link>
              ))
            )}
          </section>
          <p className="home-note">
            Chơi hết mình,
            <br />
            <strong>chia tiền nhẹ tênh.</strong>
          </p>
        </div>
      </div>
      <footer>
        <span className="brand-mini">3T</span> Thích Tính Tiền
        <span>Chơi vui, chia gọn.</span>
      </footer>
      <dialog
        ref={dialog}
        className="split-dialog"
        aria-labelledby="calc-title"
      >
        <form method="dialog">
          <button className="dialog-close" aria-label="Đóng bảng tính">
            <X size={22} />
          </button>
        </form>
        <span className="eyebrow">TÍNH NHANH</span>
        <h2 id="calc-title">Chia thử một khoản</h2>
        <p>Bảng tính xem trước, chưa lưu khoản thanh toán.</p>
        <label htmlFor="quick-amount">Tổng tiền (đ)</label>
        <input
          id="quick-amount"
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <label htmlFor="quick-count">Số người</label>
        <input
          id="quick-count"
          type="number"
          min="1"
          max="100"
          value={count}
          onChange={(event) => setCount(event.target.value)}
        />
        <div className="split-preview">
          {shares.map((share, i) => (
            <div key={share.memberId}>
              <span>Người {i + 1}</span>
              <strong>{formatMoney(share.amount)}</strong>
            </div>
          ))}
        </div>
        {!shares.length && (
          <p role="alert">
            Nhập tổng tiền nguyên không âm và từ 1 đến 100 người.
          </p>
        )}
        <button
          className="primary full"
          type="button"
          disabled={!shares.length}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                shares
                  .map((s, i) => `Người ${i + 1}: ${formatMoney(s.amount)}`)
                  .join("\n"),
              );
              setNotice("Đã sao chép bảng chia.");
            } catch {
              setNotice(
                "Chưa sao chép được. Bạn có thể chọn và sao chép kết quả.",
              );
            }
          }}
        >
          <Copy size={17} />
          Sao chép kết quả
        </button>
        <p role="status">{notice}</p>
      </dialog>
    </main>
  );
}
