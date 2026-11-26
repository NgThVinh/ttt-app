import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SessionBrowser from "@/components/session-browser";
import { vietnamToday } from "@/lib/calendar";
import { loadSessionOverview } from "@/lib/load-session-overview";
import { Plus } from "lucide-react";
import { loadCalendarPolls } from "@/lib/load-calendar-polls";
import LiveUpdates from "@/components/live-updates";
import { SessionWorkspaceLink } from "@/components/session-workspace-shell";
export default async function SessionsWorkspace() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const [{ sessions, error }, pollResult] = await Promise.all([
    loadSessionOverview(db, user.id),
    loadCalendarPolls(db),
  ]);
  return (
    <main className="calendar-workspace">
      <LiveUpdates
        tables={["sessions", "polls", "poll_options", "session_attendees"]}
      />
      <div className="page-heading">
        <div>
          <h1>Buổi chơi</h1>
          <Link className="quiet-link" href="/polls">
            Thăm dò lịch chơi
          </Link>
        </div>
        <SessionWorkspaceLink className="primary" create>
          <Plus size={18} aria-hidden />
          Tạo buổi chơi
        </SessionWorkspaceLink>
      </div>
      {error && <p role="alert">Chưa tải được buổi chơi.</p>}
      {!error && (
        <SessionBrowser
          sessions={sessions}
          today={vietnamToday()}
          polls={pollResult.polls}
          pollsError={pollResult.error}
        />
      )}
    </main>
  );
}
