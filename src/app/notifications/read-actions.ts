"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import type { FormResult } from "@/components/action-form";
async function identity() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  return db;
}
export async function readNotification(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { message: "Thông báo không hợp lệ." };
  const { error } = await db.rpc("mark_notification_read", { target: id.data });
  if (error) return { message: "Chưa cập nhật được." };
  revalidatePath("/notifications");
  return { ok: true, message: "Đã đánh dấu đọc." };
}
