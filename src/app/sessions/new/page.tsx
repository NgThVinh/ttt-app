import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SessionForm from "@/components/session-form";
export default async function NewSession() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: groups, error }, { data: members }] = await Promise.all([
    db.from("groups").select("id,name"),
    db
      .from("group_members")
      .select("id,group_id,display_name,user_id")
      .eq("status", "active"),
  ]);
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
        <SessionForm userId={user.id} groups={groups} members={members || []} />
      )}
    </main>
  );
}
