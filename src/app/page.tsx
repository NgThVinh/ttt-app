import { supabase } from "@/lib/supabase";
import Dashboard from "@/components/dashboard";
export default async function Home() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return <Dashboard demo />;
  const [groups, sessions] = await Promise.all([
    db.from("groups").select("id,name,sport"),
    db
      .from("sessions")
      .select("id,title,venue,starts_at,status")
      .order("starts_at", { ascending: false })
      .limit(30),
  ]);
  return (
    <Dashboard
      demo={false}
      name={user.user_metadata.full_name?.split(" ")[0] || "bạn"}
      groups={groups.data || []}
      sessions={sessions.data || []}
      setupError={!!groups.error}
    />
  );
}
