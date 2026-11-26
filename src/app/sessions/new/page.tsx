import { redirect } from "next/navigation";
import { supabase, currentUser } from "@/lib/supabase";
import SessionForm from "@/components/session-form";
import { z } from "zod";
import { expenseToolsSchema, type ExpenseTools } from "@/lib/expense-tools";
export default async function NewSession({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; poll?: string; option?: string }>;
}) {
  const db = await supabase();
  const user = await currentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  if (query.poll || query.option) redirect("/sessions");
  const requestedDate = z.iso.date().safeParse(query.date);
  const [
    { data: groups, error },
    { data: members },
    { data: recent },
    { data: profile },
    events,
  ] = await Promise.all([
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
    db
      .from("profiles")
      .select("bank_bin,bank_account_no,bank_account_name")
      .eq("id", user.id)
      .maybeSingle(),
    db
      .from("sessions")
      .select("id,group_id,title,starts_at,ends_at")
      .eq("status", "planned")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(150),
  ]);
  const suggestions: Record<string, { venue: string }> = {};
  for (const s of recent || [])
    if (!suggestions[s.group_id] && s.venue && s.venue !== "Chưa chọn sân")
      suggestions[s.group_id] = { venue: s.venue };
  const toolsByGroup: Record<string, ExpenseTools> = {};
  await Promise.all(
    (groups || []).map(async (g) => {
      const { data } = await db.rpc("expense_tools", { g: g.id });
      const p = expenseToolsSchema.safeParse(data);
      if (p.success) toolsByGroup[g.id] = p.data;
    }),
  );
  return (
    <main className="session-composer">
      <div className="page-heading">
        <h1>Tạo buổi chơi</h1>
      </div>
      {query.date && !requestedDate.success ? (
        <p role="alert">Ngày không hợp lệ. Hãy chọn lại ngày trong lịch.</p>
      ) : error || events.error ? (
        <p role="alert">Chưa tải được thông tin tạo buổi.</p>
      ) : !groups?.length ? (
        <p>Bạn cần tham gia nhóm trước.</p>
      ) : (
        <SessionForm
          key={requestedDate.success ? requestedDate.data : "new"}
          initialDate={requestedDate.success ? requestedDate.data : undefined}
          userId={user.id}
          groups={groups}
          members={members || []}
          toolsByGroup={toolsByGroup}
          initialTime={new Date().toISOString()}
          suggestions={suggestions}
          events={events.data || []}
          bankReady={
            !!(
              profile?.bank_bin &&
              profile.bank_account_no &&
              profile.bank_account_name
            )
          }
        />
      )}
    </main>
  );
}
export const metadata = { title: "Tạo buổi chơi" };
