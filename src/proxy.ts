import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { verifiedSuperAdmin } from "@/lib/super-admin-access";
export async function proxy(request: NextRequest) {
  // Supabase falls back to Site URL when an OAuth redirect isn't allowlisted.
  // Handle success and failure at the callback before the membership/auth gate.
  if (
    request.nextUrl.pathname === "/" &&
    request.method === "GET" &&
    (request.nextUrl.searchParams.has("code") ||
      request.nextUrl.searchParams.has("error") ||
      request.nextUrl.searchParams.has("error_code"))
  ) {
    const target = request.nextUrl.clone();
    target.pathname = "/auth/callback";
    const redirected = NextResponse.redirect(target);
    redirected.headers.set("Cache-Control", "private, no-store");
    redirected.headers.set("Referrer-Policy", "no-referrer");
    return redirected;
  }
  let response = NextResponse.next({ request });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return response;
  const db = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) => {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  const { data: identity } = await db.auth.getClaims();
  const path = request.nextUrl.pathname;
  const open =
    path === "/login" ||
    path === "/register" ||
    path === "/welcome" ||
    path.startsWith("/join/") ||
    path.startsWith("/auth/") ||
    path.startsWith("/api/cron/");
  function redirect(path: string) {
    const result = NextResponse.redirect(new URL(path, request.url));
    for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  }
  if (!open) {
    if (!identity?.claims?.sub) {
      if (path.startsWith("/api/"))
        return NextResponse.json({ error: "Cần đăng nhập." }, { status: 401 });
      return redirect("/login");
    }
    const membership = await db
      .from("group_members")
      .select("id")
      .eq("user_id", identity.claims.sub)
      .eq("status", "active")
      .limit(1);
    if (membership.error)
      return new NextResponse("Chưa kiểm tra được nhóm. Vui lòng thử lại.", {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      });
    if (!membership.data?.length) {
      if (
        [
          "/",
          "/groups",
          "/audit",
          "/ai/settings",
          "/api/navigation",
          "/api/notifications/preview",
        ].includes(path) &&
        (await verifiedSuperAdmin(db))
      ) {
        if (path === "/") return redirect("/groups");
        response.headers.set("Cache-Control", "private, no-store");
        return response;
      }
      if (request.method !== "GET" || path.startsWith("/api/"))
        return NextResponse.json(
          { error: "Bạn cần tham gia nhóm qua link mời trước." },
          { status: 403, headers: { "Cache-Control": "private, no-store" } },
        );
      return redirect("/welcome");
    }
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: [
    "/((?!_next/|favicon.ico|icon.svg|icon-192.png|icon-512.png|icon-maskable.png|apple-touch-icon.png|offline.html|sw.js|manifest.webmanifest|robots.txt).*)",
  ],
};
