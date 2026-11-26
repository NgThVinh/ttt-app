import Link from "@/components/app-link";
import {
  Plus,
  ArrowRight,
  CalendarCheck2,
  TrendingUp,
  MapPin,
} from "lucide-react";
import { formatMoney } from "@/lib/money";
import { vietnamToday, shiftDate } from "@/lib/calendar";
import {
  sessionDay,
  sessionTime,
  type SessionOverview,
} from "@/lib/session-overview";
import {
  participationWindow,
  weeklyFrequency,
  type ParticipationActivity,
} from "@/lib/participation-activity";
import ParticipationGraph from "./participation-graph";
import LiveUpdates from "./live-updates";

export default function HomeOverview({
  name = "bạn",
  sessions = [],
  setupError = false,
  summary = null,
  activity = null,
  now,
}: {
  name?: string;
  groups?: { id: string; name: string; sport: string }[];
  sessions?: SessionOverview[];
  setupError?: boolean;
  demo?: boolean;
  now?: string;
  activity?: ParticipationActivity | null;
  summary?: {
    owe: string;
    owed: string;
    payCount: number;
    receiveCount: number;
  } | null;
}) {
  const today = activity?.today || vietnamToday();
  const showGroup = new Set(sessions.map((s) => s.group_name)).size > 1;
  const currentTime = new Date(now || today + "T00:00:00+07:00").getTime();
  const upcoming = sessions
    .filter(
      (s) =>
        s.status === "planned" &&
        new Date(s.starts_at).getTime() >= currentTime,
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 3);
  const stats = activity ? participationWindow(activity, 26) : null;
  return (
    <main className="minimal-home activity-home">
      <LiveUpdates
        tables={[
          "sessions",
          "session_attendees",
          "settlements",
          "notifications",
        ]}
      />
      <div className="page-heading">
        <div>
          <h1>Chào {name}</h1>
          <p>
            {new Intl.DateTimeFormat("vi-VN", {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: "UTC",
            }).format(new Date(today + "T12:00:00Z"))}
          </p>
        </div>
        <Link href="/sessions/new" className="primary">
          <Plus size={18} aria-hidden />
          Tạo buổi chơi
        </Link>
      </div>
      {setupError && (
        <p role="alert">Chưa tải được dữ liệu. Vui lòng thử lại.</p>
      )}
      <section className="home-stats" aria-label="Tổng quan của bạn">
        <Link href="/debts" className="home-stat">
          <span>
            Cần trả <ArrowRight size={14} aria-hidden />
          </span>
          <strong>{summary ? formatMoney(summary.owe) : "—"}</strong>
          <small>
            {summary
              ? `${summary.payCount} khoản cần thanh toán`
              : "Chưa tải được"}
          </small>
        </Link>
        <Link href="/debts" className="home-stat">
          <span>
            Cần thu <ArrowRight size={14} aria-hidden />
          </span>
          <strong>{summary ? formatMoney(summary.owed) : "—"}</strong>
          <small>
            {summary
              ? `${summary.receiveCount} khoản chờ nhận`
              : "Chưa tải được"}
          </small>
        </Link>
        <div className="home-stat">
          <span>
            Đã tham gia <CalendarCheck2 size={15} aria-hidden />
          </span>
          <strong>
            {stats ? (
              <>
                {stats.mine}
                <small> buổi</small>
              </>
            ) : (
              "—"
            )}
          </strong>
          <small>26 tuần qua</small>
        </div>
        <div className="home-stat">
          <span>
            Tần suất của bạn <TrendingUp size={15} aria-hidden />
          </span>
          <strong>
            {stats ? (
              <>
                {weeklyFrequency(stats.mine, 26)}
                <small> buổi/tuần</small>
              </>
            ) : (
              "—"
            )}
          </strong>
          <small>
            {stats
              ? `${stats.activeWeeks}/26 tuần có tham gia`
              : "Chưa tải được"}
          </small>
        </div>
      </section>
      <div className="home-activity-layout">
        {activity ? (
          <ParticipationGraph activity={activity} />
        ) : (
          <section className="panel participation-card">
            <h2>Nhịp chơi</h2>
            <p role="alert">
              Chưa tải được hoạt động tham gia. Vui lòng thử lại.
            </p>
          </section>
        )}
        <section className="panel home-upcoming" aria-label="Lịch sắp tới">
          <div className="section-heading">
            <h2>Lịch sắp tới</h2>
            <Link href="/sessions">
              Xem tất cả <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
          {upcoming.length ? (
            <ul>
              {upcoming.map((s) => {
                const day = sessionDay(s.starts_at);
                return (
                  <li key={s.id}>
                    <Link
                      href={`/sessions/${s.id}`}
                      className="home-upcoming-row"
                    >
                      <div className="home-upcoming-time">
                        <span>
                          {day === today
                            ? "Hôm nay"
                            : day === shiftDate(today, 1)
                              ? "Ngày mai"
                              : day.slice(5).split("-").reverse().join("/")}
                        </span>
                        <strong>{sessionTime(s.starts_at)}</strong>
                      </div>
                      <div className="home-upcoming-info">
                        <h3>{s.title}</h3>
                        <p>
                          <MapPin size={12} aria-hidden />
                          {s.venue || "Chưa chọn sân"}
                        </p>
                        {showGroup && <small>{s.group_name} · </small>}
                        <small
                          className={
                            s.my_rsvp === "going" ? "attendance-accepted" : ""
                          }
                        >
                          {s.my_rsvp === "going"
                            ? "Bạn đã nhận lời"
                            : s.my_rsvp === "not_going"
                              ? "Bạn không tham gia"
                              : "Chờ bạn nhận lời"}
                        </small>
                      </div>
                      <ArrowRight size={15} aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="home-upcoming-empty">
              <CalendarCheck2 size={26} aria-hidden />
              <p>Chưa có lịch chơi sắp tới.</p>
              <Link href="/sessions/new">Tạo buổi chơi</Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
