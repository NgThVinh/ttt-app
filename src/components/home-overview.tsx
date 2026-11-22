import Link from "next/link";
import { Plus, ArrowRight, CalendarDays } from "lucide-react";
import { formatMoney } from "@/lib/money";
type Session = {
  id: string;
  title: string;
  venue: string;
  starts_at: string;
  status: string;
};
export default function HomeOverview({
  name = "bạn",
  sessions = [],
  setupError = false,
  summary = null,
}: {
  name?: string;
  groups?: { id: string; name: string; sport: string }[];
  sessions?: Session[];
  setupError?: boolean;
  demo?: boolean;
  summary?: {
    owe: string;
    owed: string;
    payCount: number;
    receiveCount: number;
  } | null;
}) {
  const upcoming = sessions
    .filter((s) => s.status === "planned")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const date = (value: string) =>
    new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(new Date(value));
  return (
    <main className="minimal-home">
      <div className="page-heading">
        <div>
          <h1>Chào {name}</h1>
          <p>Lịch chơi và tiền sân của bạn.</p>
        </div>
        <Link href="/sessions/new" className="primary">
          <Plus size={18} />
          Tạo buổi chơi
        </Link>
      </div>
      {setupError && (
        <p role="alert">Chưa tải được dữ liệu. Vui lòng thử lại.</p>
      )}
      <section className="simple-balances" aria-label="Công nợ của tôi">
        <Link href="/debts">
          <span>Cần trả</span>
          <strong>{summary ? formatMoney(summary.owe) : "—"}</strong>
        </Link>
        <Link href="/debts">
          <span>Cần thu</span>
          <strong>{summary ? formatMoney(summary.owed) : "—"}</strong>
        </Link>
      </section>
      <section className="panel">
        <h2>Buổi tiếp theo</h2>
        {upcoming ? (
          <>
            <p className="simple-date">
              <CalendarDays size={17} />
              {date(upcoming.starts_at)}
            </p>
            <h3>{upcoming.title}</h3>
            <p>{upcoming.venue || "Chưa chọn địa điểm"}</p>
            <Link className="secondary" href={`/sessions/${upcoming.id}`}>
              Xem buổi chơi
              <ArrowRight size={16} />
            </Link>
          </>
        ) : (
          <>
            <p>Chưa có lịch chơi sắp tới.</p>
            <Link href="/polls" className="secondary">
              Hẹn lịch cùng nhóm
            </Link>
          </>
        )}
      </section>
      <Link className="simple-review-link" href="/approvals">
        Chờ tôi duyệt <ArrowRight size={16} />
      </Link>
      <details className="home-history">
        <summary>Buổi chơi gần đây</summary>
        {sessions.length ? (
          sessions.slice(0, 5).map((s) => (
            <Link
              className="home-session"
              key={s.id}
              href={`/sessions/${s.id}`}
            >
              <span>
                <strong>{s.title}</strong>
                <small>{date(s.starts_at)}</small>
              </span>
              <ArrowRight size={16} />
            </Link>
          ))
        ) : (
          <p>Chưa có buổi chơi.</p>
        )}
      </details>
    </main>
  );
}
