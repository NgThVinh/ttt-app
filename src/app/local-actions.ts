"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { localDevelopmentEnabled } from "@/lib/local-development";
import {
  allowsLocalRequest,
  localAccounts,
} from "@/lib/local-development-config.mjs";
import { safeReturnPath } from "@/lib/auth-redirect";
import { supabase } from "@/lib/supabase";
import { verifiedSuperAdmin } from "@/lib/super-admin-access";

export async function localLogin(form: FormData) {
  if (!localDevelopmentEnabled()) notFound();
  const request = await headers();
  if (
    !allowsLocalRequest(
      request.get("host"),
      request.get("origin"),
      process.env.NEXT_PUBLIC_APP_URL,
    )
  )
    notFound();
  const account = localAccounts.find(
    (candidate) => candidate.id === form.get("account"),
  );
  const password = process.env.THREE_T_LOCAL_AUTH_PASSWORD;
  const next = safeReturnPath(form.get("next"));
  if (!account || !password || password.length < 16) redirect("/login?error=1");
  // Real local Auth issues the session; all group permissions still use JWT/RLS.
  const db = await supabase();
  const { data, error } = await db.auth.signInWithPassword({
    email: account.email,
    password,
  });
  if (error || !data.user)
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  revalidatePath("/", "layout");
  if (next === "/") {
    const membership = await db
      .from("group_members")
      .select("id")
      .eq("user_id", data.user.id)
      .eq("status", "active")
      .limit(1);
    if (membership.error) redirect("/login?error=1");
    if (!membership.data?.length)
      redirect((await verifiedSuperAdmin(db)) ? "/groups" : "/welcome");
  }
  redirect(next);
}
