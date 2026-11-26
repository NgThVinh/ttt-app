import Link from "next/link";
import { Plus, ArrowRight, CheckCheck } from "lucide-react";
import { formatMoney } from "@/lib/money";
import SessionListItem from "./session-list-item";
import { vietnamToday } from "@/lib/calendar";
import { sessionDay, type SessionOverview } from "@/lib/session-overview";
export default function HomeOverview({
  name = "bạn",
  sessions = [],
  setupError = false,
  summary = null,
}: {
  name?: string;
  groups?: { id: string; name: string; sport: string }[];
  sessions?: SessionOverview[];
  setupError?: boolean;
  demo?: boolean;
  summary?: {
    owe: string;
    owed: string;
    payCount: number;
    receiveCount: number;
  } | null;
}) {
  const today = vietnamToday();
  const showGroup = new Set(sessions.map((s) => s.group_name)).size > 1;
  const upcoming = sessions
    .filter((s) => s.status === "planned" && sessionDay(s.starts_at) >= today)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const recent = sessions
    .filter((s) => !upcoming.some((u) => u.id === s.id))
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
    .slice(0, 3);
  return (
    <main className="minimal-home">
      <div className="page-heading">
        <div>
          <h1>Chào {name}</h1>
        </div>
        <Link href="/sessions/new" className="primary">
          <Plus size={18} />
          Tạo buổi chơi
        </Link>
      </div>
      {setupError && (
        <p role="alert">Chưa tải được dữ liệu. Vui lòng thử lại.</p>
      )}
      <section
        className="simple-balances overview-balances"
        aria-label="Công nợ của tôi"
      >
        <Link href="/debts">
          <span>Cần trả</span>
          <strong>{summary ? formatMoney(summary.owe) : "—"}</strong>
          <small>
            {summary ? `${summary.payCount} khoản` : "Chưa tải được"}
          </small>
        </Link>
        <Link href="/debts">
          <span>Cần thu</span>
          <strong>{summary ? formatMoney(summary.owed) : "—"}</strong>
          <small>
            {summary ? `${summary.receiveCount} khoản` : "Chưa tải được"}
          </small>
        </Link>
      </section>
      <div className={`home-columns${recent.length ? "" : " home-single"}`}>
        <section>
          <div className="section-heading">
            <h2>Lịch sắp tới</h2>
            <Link href="/sessions">
              Tất cả <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
          {upcoming.length ? (
            upcoming
              .slice(0, 5)
              .map((s) => (
                <SessionListItem key={s.id} session={s} showGroup={showGroup} />
              ))
          ) : (
            <div className="panel">
              <p>Chưa có lịch chơi sắp tới.</p>
              <Link href="/sessions">Tạo buổi chơi</Link>
            </div>
          )}
        </section>
        {recent.length > 0 && (
          <section>
            <div className="section-heading">
              <h2>Buổi gần đây</h2>
            </div>
            {recent.map((s) => (
              <SessionListItem key={s.id} session={s} showGroup={showGroup} />
            ))}
          </section>
        )}
      </div>
      <Link className="simple-review-link" href="/approvals">
        <CheckCheck size={18} aria-hidden />
        Yêu cầu <ArrowRight size={16} aria-hidden />
      </Link>
    </main>
  );
}
