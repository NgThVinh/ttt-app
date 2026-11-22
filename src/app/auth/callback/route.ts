import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { safeReturnPath } from "@/lib/auth-redirect";
export async function GET(request: NextRequest) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || request.url;
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const db = await supabase();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(
          safeReturnPath(request.nextUrl.searchParams.get("next")),
          origin,
        ),
      );
  }
  return NextResponse.redirect(new URL("/login?error=1", origin));
}
