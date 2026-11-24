import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import PollForm from "@/components/poll-form";
export default async function NewPoll() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: groups, error }, { data: recent }] = await Promise.all([
    db.from("groups").select("id,name"),
    db
      .from("sessions")
      .select("group_id,venue")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const suggestions: Record<string, { venue: string }> = {};
  for (const s of recent || [])
    if (!suggestions[s.group_id] && s.venue && s.venue !== "Chưa chọn sân")
      suggestions[s.group_id] = { venue: s.venue };
  return (
    <main className="poll-workspace">
      <div className="page-heading">
        <div>
          <Link href="/polls">Các thăm dò</Link>
          <h1>Tạo thăm dò</h1>
        </div>
      </div>
      <p>
        Thêm vài khung giờ. Mỗi người tự chọn đi được, có thể hoặc không đi.
      </p>
      {error ? (
        <p role="alert">Chưa tải được nhóm.</p>
      ) : groups?.length ? (
        <PollForm
          groups={groups}
          suggestions={suggestions}
          initialTime={new Date().toISOString()}
        />
      ) : (
        <p>Bạn cần tham gia nhóm trước.</p>
      )}
    </main>
  );
}
export const metadata = { title: "Tạo thăm dò" };
