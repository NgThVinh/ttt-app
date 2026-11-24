import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SessionBrowser from "@/components/session-browser";
import { vietnamToday } from "@/lib/calendar";
import { loadSessionOverview } from "@/lib/load-session-overview";
import { Plus } from "lucide-react";
export default async function Sessions() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { sessions, error } = await loadSessionOverview(db, user.id);
  return (
    <main>
      <div className="page-heading">
        <div>
          <h1>Buổi chơi</h1>
          <Link className="quiet-link" href="/polls">
            Thăm dò lịch chơi
          </Link>
        </div>
        <Link className="primary" href="/sessions/new">
          <Plus size={18} aria-hidden />
          Tạo buổi chơi
        </Link>
      </div>
      {error && <p role="alert">Chưa tải được buổi chơi.</p>}
      {!error && <SessionBrowser sessions={sessions} today={vietnamToday()} />}
    </main>
  );
}
export const metadata = { title: "Buổi chơi" };
