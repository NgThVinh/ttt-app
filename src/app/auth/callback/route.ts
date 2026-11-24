import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { safeReturnPath } from "@/lib/auth-redirect";
import { authErrorReason } from "@/lib/auth-errors";
export async function GET(request: NextRequest) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || request.url;
  const next = safeReturnPath(request.nextUrl.searchParams.get("next"));
  const code = request.nextUrl.searchParams.get("code");
  let reason = authErrorReason(
    request.nextUrl.searchParams.get("error_code") ||
      request.nextUrl.searchParams.get("error"),
  );
  function redirect(path: string) {
    const response = NextResponse.redirect(new URL(path, origin));
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  if (
    code ||
    request.nextUrl.searchParams.has("error") ||
    request.nextUrl.searchParams.has("error_code")
  ) {
    const db = await supabase();
    if (
      code &&
      !request.nextUrl.searchParams.has("error") &&
      !request.nextUrl.searchParams.has("error_code")
    ) {
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error) return redirect(next);
      reason = authErrorReason(error.code);
    }
    // A second callback can fail after the first one has set a valid session.
    // Verify that session with Auth; never treat the error query as identity.
    const { data, error } = await db.auth.getUser();
    if (!error && data.user) return redirect(next);
  }
  const target = new URL(
    request.nextUrl.searchParams.get("mode") === "register"
      ? "/register"
      : "/login",
    origin,
  );
  target.searchParams.set("error", reason);
  if (next !== "/") target.searchParams.set("next", next);
  return redirect(target.pathname + target.search);
}
