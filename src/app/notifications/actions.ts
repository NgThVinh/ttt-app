"use server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import type { FormResult } from "@/components/action-form";
const subscriptionSchema = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});
export async function subscribePush(value: unknown) {
  const p = subscriptionSchema.safeParse(value);
  if (!p.success) return { error: "Đăng ký thiết bị không hợp lệ." };
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { error: "Cần đăng nhập lại." };
  const { error } = await db.rpc("save_push_subscription", {
    endpoint_text: p.data.endpoint,
    p256dh_text: p.data.keys.p256dh,
    auth_text: p.data.keys.auth,
  });
  return error
    ? { error: "Chưa lưu được đăng ký. Hãy tắt push rồi bật lại." }
    : { ok: true };
}
export async function unsubscribePush(endpoint: unknown) {
  const p = z.url().max(2048).safeParse(endpoint);
  if (!p.success) return { error: "Thiết bị không hợp lệ." };
  const db = await supabase();
  const { error } = await db.rpc("remove_push_subscription", {
    endpoint_text: p.data,
  });
  return error ? { error: "Chưa hủy được. Vui lòng thử lại." } : { ok: true };
}
export async function remindPayment(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const p = z.uuid().safeParse(form.get("target"));
  if (!p.success) return { message: "Khoản không hợp lệ." };
  const db = await supabase();
  const { error } = await db.rpc("remind_payment", { target: p.data });
  return error
    ? {
        message:
          "Chưa gửi được. Chỉ người thu được nhắc khoản đang chờ, tối đa một lần trong 24 giờ.",
      }
    : {
        ok: true,
        message: "Đã gửi nhắc trong app và tới các thiết bị bật push.",
      };
}
