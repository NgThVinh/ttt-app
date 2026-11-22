import { z } from "zod";
import type { supabase } from "@/lib/supabase";
/** Only the user's authenticated client is accepted here. Credentials never enter context. */
export async function groupContext(
  db: Awaited<ReturnType<typeof supabase>>,
  groupId: string,
  userId: string,
) {
  z.uuid().parse(groupId);
  const membership = await db
    .from("group_members")
    .select("id,role")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (membership.error || !membership.data)
    throw Error("Không có quyền truy cập nhóm.");
  const [{ data: group }, { data: members }, { data: sessions }] =
    await Promise.all([
      db.from("groups").select("id,name,sport").eq("id", groupId).single(),
      db
        .from("group_members")
        .select("id,display_name,aliases")
        .eq("group_id", groupId)
        .eq("status", "active")
        .limit(100),
      db
        .from("sessions")
        .select("id,title,starts_at,status,revision,collector_member_id")
        .eq("group_id", groupId)
        .order("starts_at", { ascending: false })
        .limit(20),
    ]);
  if (!group) throw Error("Không tải được nhóm.");
  return {
    group,
    actor: membership.data,
    members: members || [],
    sessions: sessions || [],
  };
}
