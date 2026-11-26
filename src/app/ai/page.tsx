import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import AIChat from "@/components/ai-chat";
import { draftCommandLabels } from "@/lib/ai/draft-labels";
export default async function AI() {
  const db = await supabase(),
    {
      data: { user },
    } = await db.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: groups }, { data: settings }, { data: drafts }] =
    await Promise.all([
      db.from("groups").select("id,name"),
      db
        .from("group_ai_settings")
        .select("group_id")
        .eq("status", "approved")
        .eq("enabled", true),
      db
        .from("ai_drafts")
        .select("id,tier,command,expires_at")
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
  const enabled =
    groups?.filter((g) => settings?.some((s) => s.group_id === g.id)) || [];
  return (
    <main>
      <Link href="/">Trang chủ</Link>
      <h1>Trợ lý 3T</h1>
      {enabled.length ? (
        <AIChat groups={enabled} />
      ) : (
        <section className="panel">
          <p>Nhóm của bạn chưa bật AI.</p>
          <Link href="/ai/settings">Cài đặt AI</Link>
        </section>
      )}
      <section className="panel">
        <h2>Bản nháp chờ xác nhận</h2>
        {!drafts?.length && <p>Chưa có bản nháp cần xác nhận.</p>}
        {drafts?.map((d) => (
          <p key={d.id}>
            <Link href={`/ai/drafts/${d.id}`}>
              {draftCommandLabels[d.command] || "Xem bản nháp"}
            </Link>
          </p>
        ))}
      </section>
    </main>
  );
}
export const metadata = { title: "Trợ lý 3T" };
