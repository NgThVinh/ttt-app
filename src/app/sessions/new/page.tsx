import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SessionForm from "@/components/session-form";
import { expenseToolsSchema, type ExpenseTools } from "@/lib/expense-tools";
export default async function NewSession() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: groups, error }, { data: members }, { data: recent }] =
    await Promise.all([
      db.from("groups").select("id,name"),
      db
        .from("group_members")
        .select("id,group_id,display_name,user_id")
        .eq("status", "active"),
      db
        .from("sessions")
        .select("group_id,venue")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
  const suggestions: Record<string, { venue: string }> = {};
  for (const session of recent || []) {
    if (
      !suggestions[session.group_id] &&
      session.venue &&
      session.venue !== "Chưa chọn sân"
    )
      suggestions[session.group_id] = { venue: session.venue };
  }
  const toolsByGroup: Record<string, ExpenseTools> = {};
  await Promise.all(
    (groups || []).map(async (g) => {
      const { data } = await db.rpc("expense_tools", { g: g.id });
      const parsed = expenseToolsSchema.safeParse(data);
      if (parsed.success) toolsByGroup[g.id] = parsed.data;
    }),
  );
  return (
    <main>
      <Link href="/sessions">Buổi chơi</Link>
      <h1>Tạo buổi chơi</h1>
      {error ? (
        <p role="alert">Chưa tải được nhóm.</p>
      ) : !groups?.length ? (
        <p>
          Bạn cần tham gia nhóm trước. <Link href="/groups">Xem nhóm</Link>
        </p>
      ) : (
        <SessionForm
          userId={user.id}
          groups={groups}
          members={members || []}
          toolsByGroup={toolsByGroup}
          initialTime={new Date().toISOString()}
          suggestions={suggestions}
        />
      )}
    </main>
  );
}
export const metadata = { title: "Tạo buổi chơi" };
