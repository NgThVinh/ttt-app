import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
export async function GET() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return NextResponse.json(
      { canAudit: false },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  const result = await db.rpc("can_view_audit");
  return NextResponse.json(
    { canAudit: !result.error && result.data === true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
