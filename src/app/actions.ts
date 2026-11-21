"use server";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { safeReturnPath } from "@/lib/auth-redirect";
export async function login(form: FormData) {
  const next = safeReturnPath(form.get("next"));
  const email = z.email().safeParse(form.get("email"));
  if (!email.success)
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  const db = await supabase();
  const { error } = await db.auth.signInWithOtp({
    email: email.data,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  redirect(`/login?sent=1&next=${encodeURIComponent(next)}`);
}
export async function googleLogin(form: FormData) {
  const next = safeReturnPath(form.get("next"));
  const db = await supabase();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error || !data.url)
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  redirect(data.url);
}
export async function logout() {
  const db = await supabase();
  await db.auth.signOut();
  redirect("/login");
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
