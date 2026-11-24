"use server";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { safeReturnPath } from "@/lib/auth-redirect";
export async function login(form: FormData) {
  return emailAuth(form, false);
}
export async function register(form: FormData) {
  return emailAuth(form, true);
}
async function emailAuth(form: FormData, signup: boolean) {
  const page = signup ? "/register" : "/login";
  const next = safeReturnPath(form.get("next"));
  const email = z.email().safeParse(form.get("email"));
  if (!email.success)
    redirect(`${page}?error=1&next=${encodeURIComponent(next)}`);
  const db = await supabase();
  const { error } = await db.auth.signInWithOtp({
    email: email.data,
    options: {
      shouldCreateUser: signup,
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback?next=${encodeURIComponent(next)}&mode=${signup ? "register" : "login"}`,
    },
  });
  // Keep unknown email responses identical; never expose account existence.
  if (error && !["otp_disabled", "user_not_found"].includes(error.code || ""))
    redirect(
      `${page}?error=${["over_email_send_rate_limit", "over_request_rate_limit"].includes(error.code || "") ? "rate_limited" : signup ? "registration_failed" : "sign_in_failed"}&next=${encodeURIComponent(next)}`,
    );
  redirect(`${page}?sent=1&next=${encodeURIComponent(next)}`);
}
export async function googleLogin(form: FormData) {
  const mode = form.get("mode") === "register" ? "register" : "login";
  const next = safeReturnPath(form.get("next"));
  const db = await supabase();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback?next=${encodeURIComponent(next)}&mode=${mode}`,
    },
  });
  if (error || !data.url)
    redirect(`/${mode}?error=1&next=${encodeURIComponent(next)}`);
  redirect(data.url);
}
export async function logout(form?: FormData) {
  const db = await supabase();
  await db.auth.signOut();
  const next = safeReturnPath(form?.get("next"));
  redirect(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
}
export async function payment(form: FormData) {
  const db = await supabase();
  const id = z.uuid().parse(form.get("id"));
  const op = z.enum(["mark", "confirm"]).parse(form.get("operation"));
  const { error } = await db.rpc("payment_action", {
    target: id,
    operation: op,
  });
  if (error)
    throw new Error(
      "Khoản tiền đã thay đổi hoặc bạn không có quyền. Vui lòng tải lại.",
    );
  revalidatePath("/");
}
