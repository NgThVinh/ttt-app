import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import PollForm from "@/components/poll-form";
import LiveUpdates from "@/components/live-updates";
export default async function Polls() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: groups }, { data, error }] = await Promise.all([
    db.from("groups").select("id,name"),
    db
      .from("polls")
      .select("id,title,status,closes_at")
      .order("created_at", { ascending: false }),
  ]);
  return (
    <main>
      <Link href="/">Trang chủ</Link> · <Link href="/sessions">Buổi chơi</Link>
      <h1>Hẹn lịch chơi</h1>
      <LiveUpdates tables={["polls"]} />
      {error && <p role="alert">Chưa tải được thăm dò.</p>}
      {data?.map((p) => (
        <section className="panel" key={p.id}>
          <Link href={`/polls/${p.id}`}>
            <h2>{p.title}</h2>
            <p>
              {p.status === "closed"
                ? "Đã chốt"
                : "Hạn trả lời: " +
                  new Date(p.closes_at).toLocaleString("vi-VN", {
                    timeZone: "Asia/Ho_Chi_Minh",
                  })}
            </p>
          </Link>
        </section>
      ))}
      {!data?.length && !error && (
        <p>Chưa có thăm dò. Tạo lịch để cả nhóm cùng chọn nhé.</p>
      )}
      {!!groups?.length && (
        <>
          <h2>Tạo thăm dò</h2>
          <PollForm groups={groups} />
        </>
      )}
    </main>
  );
}
export const metadata = { title: "Thăm dò lịch chơi" };
