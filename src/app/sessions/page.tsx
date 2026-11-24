import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SessionBrowser from "@/components/session-browser";
import { vietnamToday } from "@/lib/calendar";
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
      <p>
        <Link href="/polls">Thăm dò lịch chơi</Link> ·{" "}
        <Link href="/notifications">Thông báo</Link>
      </p>
      <Link className="primary" href="/sessions/new">
        Tạo buổi chơi
      </Link>
      {error && <p role="alert">Chưa tải được buổi chơi.</p>}
      {!error && (
        <SessionBrowser sessions={data || []} today={vietnamToday()} />
      )}
    </main>
  );
}
export const metadata = { title: "Buổi chơi" };
