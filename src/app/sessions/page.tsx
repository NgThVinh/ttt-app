import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
export default async function Sessions() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await db
    .from("sessions")
    .select("id,title,venue,starts_at,status")
    .order("starts_at", { ascending: false });
  return (
    <main>
      <Link href="/">Trang chủ</Link>
      <h1>Buổi chơi</h1>
      <Link className="primary" href="/sessions/new">
        Tạo buổi chơi
      </Link>
      {error && <p role="alert">Chưa tải được buổi chơi.</p>}
      {!data?.length && !error && (
        <p>Chưa có buổi chơi. Cùng nhóm tạo buổi đầu tiên nhé.</p>
      )}
      {data?.map((s) => (
        <section className="panel" key={s.id}>
          <Link href={`/sessions/${s.id}`}>
            <h2>{s.title}</h2>
            <p>
              {s.venue} ·{" "}
              {new Date(s.starts_at).toLocaleString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
              })}{" "}
              ·{" "}
              {s.status === "planned"
                ? "Sắp tới"
                : s.status === "settled"
                  ? "Đã thu đủ"
                  : s.status === "cancelled"
                    ? "Đã hủy"
                    : "Đang thu tiền"}
            </p>
          </Link>
        </section>
      ))}
    </main>
  );
}
