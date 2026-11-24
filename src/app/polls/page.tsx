import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import LiveUpdates from "@/components/live-updates";
import { pollStatus } from "@/lib/poll-draft";
export default async function Polls() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: groups }, { data: polls, error }] = await Promise.all([
    db.from("groups").select("id,name"),
    db
      .from("polls")
      .select("id,group_id,title,venue,status,closes_at,resulting_session_id")
      .order("created_at", { ascending: false }),
  ]);
  const now = new Date().getTime(),
    active = (polls || []).filter(
      (p) =>
        p.status === "open" &&
        Date.parse(p.closes_at) > now &&
        !p.resulting_session_id,
    ),
    past = (polls || []).filter((p) => !active.some((a) => a.id === p.id));
  function rows(list: typeof active) {
    return list.map((p) => (
      <Link className="poll-list-row" key={p.id} href={`/polls/${p.id}`}>
        <div>
          <h3>{p.title}</h3>
          <p>
            {groups?.find((g) => g.id === p.group_id)?.name}
            {p.venue !== "Chưa chọn sân" ? ` · ${p.venue}` : ""}
          </p>
        </div>
        <div className="poll-list-meta">
          <span
            className={active.some((a) => a.id === p.id) ? "poll-open" : ""}
          >
            {pollStatus(p.status, p.closes_at, !!p.resulting_session_id, now)}
          </span>
          <small>
            {active.some((a) => a.id === p.id) ? "Trả lời trước " : ""}
            {new Date(p.closes_at).toLocaleString("vi-VN", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Ho_Chi_Minh",
            })}
          </small>
        </div>
      </Link>
    ));
  }
  return (
    <main className="poll-workspace">
      <div className="page-heading">
        <div>
          <h1>Thăm dò lịch chơi</h1>
          <p>Chọn lúc rảnh cùng nhóm, tạo buổi khi đã thống nhất.</p>
        </div>
        <Link className="primary" href="/polls/new">
          + Tạo thăm dò
        </Link>
      </div>
      <LiveUpdates tables={["polls"]} />
      {error && <p role="alert">Chưa tải được thăm dò. Hãy tải lại trang.</p>}
      {!!active.length && (
        <section aria-label="Thăm dò đang mở">
          <h2>
            Đang thăm dò <small>({active.length})</small>
          </h2>
          <div className="poll-list">{rows(active)}</div>
        </section>
      )}
      {!error && !active.length && (
        <section className="panel poll-empty">
          <h2>Chưa có thăm dò đang mở</h2>
          <p>Đưa ra vài khung giờ để mọi người chọn lúc đi được.</p>
          <Link href="/polls/new">Tạo thăm dò đầu tiên</Link>
        </section>
      )}
      {!!past.length && (
        <details className="poll-archive">
          <summary>Đã kết thúc · {past.length}</summary>
          <div className="poll-list">{rows(past)}</div>
        </details>
      )}
    </main>
  );
}
export const metadata = { title: "Thăm dò lịch chơi" };
