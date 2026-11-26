import { redirect } from "next/navigation";
import { supabase, currentUser } from "@/lib/supabase";
import SessionBrowser from "@/components/session-browser";
import { vietnamToday } from "@/lib/calendar";
import { loadSessionOverview } from "@/lib/load-session-overview";
import { Plus } from "lucide-react";
import LiveUpdates from "@/components/live-updates";
import { SessionWorkspaceLink } from "@/components/session-workspace-shell";
export default async function SessionsWorkspace() {
  const db = await supabase();
  const user = await currentUser();
  if (!user) redirect("/login");
  const { sessions, error } = await loadSessionOverview(db, user.id);
  return (
    <main className="calendar-workspace">
      <LiveUpdates
        tables={["sessions", "session_attendees", "notifications"]}
      />
      <div className="page-heading">
        <div>
          <h1>Buổi chơi</h1>
        </div>
        <SessionWorkspaceLink className="primary" create>
          <Plus size={18} aria-hidden />
          Tạo buổi chơi
        </SessionWorkspaceLink>
      </div>
      {error && <p role="alert">Chưa tải được buổi chơi.</p>}
      {!error && <SessionBrowser sessions={sessions} today={vietnamToday()} />}
    </main>
  );
}
