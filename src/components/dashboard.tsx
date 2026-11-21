"use client";
import { appName } from "@/lib/config";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Home,
  CalendarDays,
  Wallet,
  Users,
  User,
  Plus,
  ArrowUpRight,
  Bell,
  MapPin,
  Clock,
  Check,
  ChevronDown,
  Sun,
  Moon,
  Copy,
  Calculator,
  X,
  CheckCircle2,
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
const nav = [
  { name: "Trang chủ", icon: Home },
  { name: "Buổi chơi", icon: CalendarDays },
  { name: "Công nợ", icon: Wallet },
  { name: "Nhóm", icon: Users },
  { name: "Tôi", icon: User },
];
export default function Dashboard({
  demo = false,
  name = "Minh",
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
  const router = useRouter();
  const [tab, setTab] = useState("Trang chủ"),
    [dark, setDark] = useState(false),
    [modal, setModal] = useState(false),
    [amount, setAmount] = useState("400000"),
    [count, setCount] = useState("8"),
    [notice, setNotice] = useState("");
  const toast = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(""), 3500);
  };
  const shares = (() => {
    try {
      const n = Number(count);
      if (!Number.isInteger(n) || n < 1 || n > 100) return [];
      return allocate(
        BigInt(amount || "0"),
        Array.from({ length: n }, (_, i) => ({
          memberId: String(i).padStart(3, "0"),
          weight: 1n,
        })),
      );
    } catch {
      return [];
    }
  })();
  const items = demo
    ? [
        {
          id: "1",
          title: "Cầu lông tối thứ Năm",
          venue: "Sân cầu lông Thành Công",
          starts_at: "2026-11-26T12:00:00Z",
          status: "planned",
        },
        {
          id: "2",
          title: "Cuối tuần ra sân",
          venue: "Sân cầu lông Thành Công",
          starts_at: "2026-11-21T10:00:00Z",
          status: "played",
        },
        {
          id: "3",
          title: "Một buổi hết mình",
          venue: "Sân thể thao Phú Thọ",
          starts_at: "2026-11-19T12:00:00Z",
          status: "settled",
        },
      ]
    : sessions;
  const upcoming = items
    .filter((s) => s.status === "planned")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  return (
    <div className={dark ? "app dark" : "app"}>
      <aside className="sidebar">
        <Link href="/" className="brand">
          {appName}
          <span>Thích Tính Tiền</span>
        </Link>
        <div className="group-picker">
          <div className="group-icon">🏸</div>
          <div>
            <small>NHÓM CỦA BẠN</small>
            <strong>
              {demo
                ? "Hội cầu lông vui vẻ"
                : groups.length > 1
                  ? "Tất cả nhóm"
                  : groups[0]?.name || "Chưa có nhóm"}
            </strong>
          </div>
          <ChevronDown size={16} />
        </div>
        <nav>
          {nav.map(({ name, icon: Icon }) => (
            <button
              key={name}
              onClick={() =>
                !demo && name === "Nhóm"
                  ? router.push("/groups")
                  : !demo && name === "Tôi"
                    ? router.push("/me")
                    : !demo && name === "Buổi chơi"
                      ? router.push("/sessions")
                      : !demo && name === "Công nợ"
                        ? router.push("/debts")
                        : setTab(name)
              }
              className={tab === name ? "active" : ""}
            >
              <Icon size={20} />
              {name}
              {name === "Công nợ" && demo && <b className="nav-count">2</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span>✨</span>
          <strong>
            Chơi hết mình,
            <br />
            chia tiền nhẹ tênh.
          </strong>
          <p>Để mỗi buổi chơi chỉ còn niềm vui.</p>
        </div>
        <button
          className="account"
          onClick={() => (demo ? router.push("/login") : setTab("Tôi"))}
        >
          <div className="avatar mint">{name[0]}</div>
          <div>
            <strong>{name}</strong>
            <small>{demo ? "Đăng nhập để bắt đầu" : "Thành viên"}</small>
          </div>
          <ArrowUpRight size={17} />
        </button>
      </aside>
      <div className="workspace">
        <header>
          <span>
            Không gian của bạn <span className="header-slash">/</span>{" "}
            <b>{tab}</b>
          </span>
          <div className="header-actions">
            <button aria-label="Đổi giao diện" onClick={() => setDark(!dark)}>
              {dark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button
              aria-label="Thông báo"
              onClick={() =>
                demo
                  ? toast("Đăng nhập để xem thông báo.")
                  : router.push("/notifications")
              }
            >
              <Bell size={20} />
            </button>
            <div className="avatar mint">{name[0]}</div>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">HÔM NAY RA SÂN CHỨ? 🏸</div>
              <h1>Chào {name}, vui một buổi nhé!</h1>
              <p>Lịch chơi rõ ràng. Tiền nong gọn gàng. Cả nhóm thảnh thơi.</p>
            </div>
            <button className="primary" onClick={() => setModal(true)}>
              <Plus size={18} />
              Tính tiền nhanh
            </button>
          </div>
          {demo && (
            <div className="demo-banner">
              <span>
                Đây là dữ liệu minh họa. Đăng nhập để sử dụng nhóm của bạn.
              </span>
              <a href="/login">
                Bắt đầu với 3T <ArrowUpRight size={15} />
              </a>
            </div>
          )}
          {setupError && (
            <div role="alert" className="demo-banner">
              Database chưa sẵn sàng. Cần chạy migration để dùng dữ liệu thật.
            </div>
          )}
          {tab === "Trang chủ" && (
            <>
              <section className="stats">
                <article>
                  <span className="stat-icon peach">
                    <Wallet size={21} />
                  </span>
                  <small>Tôi cần trả</small>
                  <h2>
                    {demo
                      ? "125.000"
                      : summary
                        ? formatMoney(summary.owe).slice(0, -1)
                        : "—"}
                    <span>đ</span>
                  </h2>
                  <p>
                    {demo
                      ? "2 khoản đang chờ bạn"
                      : summary
                        ? `${summary.payCount} khoản cần trả`
                        : "Chưa tải được công nợ"}
                    <span className="tiny-label">Chưa trả</span>
                  </p>
                </article>
                <article>
                  <span className="stat-icon mint">
                    <ArrowUpRight size={21} />
                  </span>
                  <small>Tôi cần thu</small>
                  <h2>
                    {demo
                      ? "340.000"
                      : summary
                        ? formatMoney(summary.owed).slice(0, -1)
                        : "—"}
                    <span>đ</span>
                  </h2>
                  <p>
                    {demo
                      ? "4 người cần thanh toán"
                      : summary
                        ? `${summary.receiveCount} khoản cần thu`
                        : "Chưa tải được công nợ"}
                    <span className="tiny-label green">Cần thu</span>
                  </p>
                </article>
                <article>
                  <span className="stat-icon lavender">
                    <CalendarDays size={21} />
                  </span>
                  <small>
                    {demo ? "Buổi chơi tháng này" : "Buổi chơi gần đây"}
                  </small>
                  <h2>
                    {demo ? "8" : sessions.length}
                    <span> buổi</span>
                  </h2>
                  <p>
                    {demo
                      ? "Thêm 2 buổi so với tháng trước"
                      : "Cùng nhau tạo thêm kỷ niệm"}
                    <span>🏸</span>
                  </p>
                </article>
              </section>
              <div className="home-grid">
                <div>
                  <section className="upcoming">
                    <div className="section-title">
                      <h2>
                        Sắp tới <span className="live-dot" />
                      </h2>
                      <button
                        onClick={() =>
                          demo ? setTab("Buổi chơi") : router.push("/sessions")
                        }
                      >
                        Xem lịch chơi
                      </button>
                    </div>
                    {upcoming ? (
                      <>
                        <div className="event-head">
                          <div className="date-tile">
                            <small>
                              {new Date(upcoming.starts_at).toLocaleDateString(
                                "vi-VN",
                                {
                                  month: "short",
                                  timeZone: "Asia/Ho_Chi_Minh",
                                },
                              )}
                            </small>
                            <b>
                              {new Date(upcoming.starts_at).toLocaleDateString(
                                "vi-VN",
                                {
                                  day: "2-digit",
                                  timeZone: "Asia/Ho_Chi_Minh",
                                },
                              )}
                            </b>
                          </div>
                          <div>
                            <span className="badge green">Sắp diễn ra</span>
                            <h3>{upcoming.title}</h3>
                            <p>
                              <Clock size={15} />
                              {new Date(upcoming.starts_at).toLocaleTimeString(
                                "vi-VN",
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  timeZone: "Asia/Ho_Chi_Minh",
                                },
                              )}
                              <MapPin size={15} />
                              {upcoming.venue}
                            </p>
                          </div>
                        </div>
                        <div className="event-bottom">
                          <span>Chốt đi trước hạn của buổi nhé.</span>
                          {demo ? (
                            <button
                              className="primary"
                              onClick={() =>
                                toast("Đăng nhập để chốt tham gia.")
                              }
                            >
                              Tôi đi
                            </button>
                          ) : (
                            <Link
                              className="primary"
                              href={`/sessions/${upcoming.id}`}
                            >
                              Xem và chốt tham gia
                            </Link>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="empty">
                        Chưa có buổi sắp tới. Cùng nhóm hẹn một lịch chơi nhé.
                      </div>
                    )}
                  </section>
                  <section className="recent">
                    <div className="section-title">
                      <h2>Những buổi gần đây</h2>
                      <button
                        onClick={() =>
                          demo ? setTab("Buổi chơi") : router.push("/sessions")
                        }
                      >
                        Xem tất cả <ArrowUpRight size={16} />
                      </button>
                    </div>
                    {items
                      .filter((s) => s.status !== "planned")
                      .map((s) => (
                        <div className="session-row" key={s.id}>
                          <div className="sport-icon">🏸</div>
                          <div>
                            {demo ? (
                              <strong>{s.title}</strong>
                            ) : (
                              <Link href={`/sessions/${s.id}`}>
                                <strong>{s.title}</strong>
                              </Link>
                            )}
                            <small>
                              {new Date(s.starts_at).toLocaleDateString(
                                "vi-VN",
                                { timeZone: "Asia/Ho_Chi_Minh" },
                              )}{" "}
                              · {s.venue}
                            </small>
                          </div>
                          <span
                            className={
                              "badge " +
                              (s.status === "settled" ? "green" : "amber")
                            }
                          >
                            {s.status === "settled"
                              ? "Đã thu đủ"
                              : "Đang thu tiền"}
                          </span>
                        </div>
                      ))}
                    {!items.length && (
                      <div className="empty">
                        Những buổi chơi của nhóm sẽ hiện ở đây.
                      </div>
                    )}
                  </section>
                  <div className="quote">
                    “Chuyện tiền bạc rõ ràng, tình bạn càng bền lâu.”{" "}
                    <span>— Hội thích ra sân</span>
                  </div>
                </div>
                <section className="tasks">
                  <div className="section-title">
                    <h2>Việc cần làm</h2>
                    <span className="count">
                      {demo
                        ? 3
                        : summary
                          ? summary.payCount + summary.receiveCount
                          : "—"}
                    </span>
                  </div>
                  {demo ? (
                    <>
                      <Task
                        icon="💸"
                        title="Đừng quên phần của mình"
                        detail="75.000đ · Cuối tuần ra sân"
                        action="Xem khoản tiền"
                        onClick={() => setTab("Công nợ")}
                      />
                      <Task
                        icon="✅"
                        title="Bình báo đã chuyển tiền"
                        detail="85.000đ · Chờ bạn xác nhận"
                        action="Kiểm tra trong sao kê"
                        onClick={() =>
                          toast("Đăng nhập để xem và xác nhận khoản thực tế.")
                        }
                      />
                      <Task
                        icon="📅"
                        title="Chọn lịch cho tuần sau"
                        detail="Thăm dò · 6 người đã trả lời"
                        action="Xem thăm dò"
                        onClick={() => toast("Đăng nhập để tham gia thăm dò.")}
                      />
                    </>
                  ) : (
                    <div className="empty">
                      <CheckCircle2 size={30} />
                      <p>
                        <Link href="/debts">
                          {summary
                            ? `${summary.payCount} khoản cần trả, ${summary.receiveCount} khoản cần thu hoặc xác nhận.`
                            : "Xem công nợ của tôi"}
                        </Link>
                      </p>
                      <p>
                        <Link href="/approvals">
                          Chờ tôi duyệt và yêu cầu đã gửi
                        </Link>{" "}
                        ·{" "}
                        <Link href="/groups">
                          Xác minh thành viên trong nhóm
                        </Link>
                      </p>
                    </div>
                  )}
                  <div className="friendly-note">
                    <span>🤝</span>
                    <p>
                      Người nhận xác nhận,
                      <br />
                      cả nhóm cùng yên tâm.
                    </p>
                  </div>
                </section>
              </div>
            </>
          )}
          {tab === "Buổi chơi" && (
            <section className="panel">
              <h2>Buổi chơi của nhóm</h2>
              {items.map((s) => (
                <div className="session-row" key={s.id}>
                  <span className="sport-icon">🏸</span>
                  <div>
                    {demo ? (
                      <strong>{s.title}</strong>
                    ) : (
                      <Link href={`/sessions/${s.id}`}>
                        <strong>{s.title}</strong>
                      </Link>
                    )}
                    <small>
                      {s.venue} ·{" "}
                      {new Date(s.starts_at).toLocaleDateString("vi-VN")}
                    </small>
                  </div>
                  <span className="badge green">
                    {s.status === "planned"
                      ? "Sắp tới"
                      : s.status === "settled"
                        ? "Đã thu đủ"
                        : "Đang thu"}
                  </span>
                </div>
              ))}
              {!items.length && <p>Chưa có buổi chơi nào.</p>}
            </section>
          )}
          {tab === "Công nợ" && (
            <section className="panel">
              <h2>Công nợ của tôi</h2>
              <p>
                {demo
                  ? "Dữ liệu minh họa: bạn còn 125.000đ cần trả. Đăng nhập để xem các khoản thực tế."
                  : "Chưa có dữ liệu công nợ được kết nối trên màn hình này."}
              </p>
              <p>
                Chỉ người nhận hoặc admin dự phòng hợp lệ mới có thể xác nhận
                tiền đã nhận.
              </p>
            </section>
          )}
          {tab === "Nhóm" && (
            <section className="panel">
              <h2>Nhóm của bạn</h2>
              {groups.map((g) => (
                <div className="session-row" key={g.id}>
                  <span className="sport-icon">🏸</span>
                  <div>
                    <strong>{g.name}</strong>
                    <small>{g.sport}</small>
                  </div>
                </div>
              ))}
              {!groups.length && (
                <p>
                  Nhờ admin nhóm gửi link mời để cùng bắt đầu. Chỉ chủ ứng dụng
                  có quyền tạo nhóm.
                </p>
              )}
            </section>
          )}
          {tab === "Tôi" && (
            <section className="panel">
              <h2>Tài khoản của tôi</h2>
              <p>
                {demo
                  ? "Đăng nhập để quản lý thông tin cá nhân và ngân hàng."
                  : `Xin chào ${name}.`}
              </p>
              <a className="primary" href="/login">
                Đăng nhập
              </a>
            </section>
          )}
          <footer>
            <span className="brand-mini">{appName}</span> Thích Tính Tiền{" "}
            <span>Chơi vui, chia gọn.</span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav">
        {nav.map(({ name, icon: Icon }) => (
          <button
            className={tab === name ? "active" : ""}
            key={name}
            onClick={() =>
              !demo && name === "Nhóm"
                ? router.push("/groups")
                : !demo && name === "Tôi"
                  ? router.push("/me")
                  : !demo && name === "Buổi chơi"
                    ? router.push("/sessions")
                    : !demo && name === "Công nợ"
                      ? router.push("/debts")
                      : setTab(name)
            }
          >
            <Icon size={20} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="calc-title"
            className="modal"
          >
            <button
              className="close"
              aria-label="Đóng"
              onClick={() => setModal(false)}
            >
              <X />
            </button>
            <span className="eyebrow">CHIA THỬ TRƯỚC KHI LƯU</span>
            <h2 id="calc-title">
              <Calculator size={23} /> Tính tiền nhanh
            </h2>
            <p>Bảng tính cục bộ, chưa tạo nghĩa vụ thanh toán.</p>
            <label htmlFor="amount">Tổng tiền sân (đ)</label>
            <input
              id="amount"
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <label htmlFor="count">Số người tham gia</label>
            <input
              id="count"
              type="number"
              min="1"
              max="100"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
            <div className="split-preview">
              {shares.map((s, i) => (
                <div key={s.memberId}>
                  <span>Người {i + 1}</span>
                  <strong>{formatMoney(s.amount)}</strong>
                </div>
              ))}
            </div>
            <button
              className="primary full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    shares
                      .map((s, i) => `Người ${i + 1}: ${formatMoney(s.amount)}`)
                      .join("\n"),
                  );
                  toast("Đã sao chép bảng chia tiền.");
                } catch {
                  toast("Trình duyệt chưa cho phép sao chép.");
                }
              }}
            >
              <Copy size={17} />
              Sao chép kết quả
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function Task({
  icon,
  title,
  detail,
  action,
  onClick,
}: {
  icon: string;
  title: string;
  detail: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="task">
      <span className="task-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
        <button onClick={onClick}>
          {action} <ArrowUpRight size={14} />
        </button>
      </div>
    </div>
  );
}
