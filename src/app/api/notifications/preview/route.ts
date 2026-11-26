import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: "Cần đăng nhập." },
      { status: 401, headers },
    );
  const [items, unread] = await Promise.all([
    new URL(request.url).searchParams.get("count") === "1"
      ? Promise.resolve({ data: undefined, error: null })
      : db
          .from("notifications")
          .select("id,title,href,created_at,read_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(6),
    db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
  ]);
  if (items.error || unread.error)
    return NextResponse.json(
      { error: "Chưa tải được thông báo." },
      { status: 503, headers },
    );
  return NextResponse.json(
    { items: items.data, unread: unread.count || 0 },
    { headers },
  );
}
