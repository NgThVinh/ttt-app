"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { envAllowsSuperAdmin } from "@/lib/super-admin-config.mjs";
import { encryptGroupKey } from "@/lib/ai/crypto";
import type { FormResult } from "@/components/action-form";
export async function requestAI(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const p = z
    .object({ g: z.uuid(), reason: z.string().trim().min(1).max(500) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { message: "Kiểm tra nhóm và lý do." };
  const db = await supabase();
  const { error } = await db.rpc("request_group_ai", p.data);
  if (error)
    return {
      message: "Chỉ admin nhóm được yêu cầu; kiểm tra trạng thái hiện tại.",
    };
  revalidatePath("/ai/settings");
  return { ok: true, message: "Đã gửi yêu cầu bật AI." };
}
export async function configureAI(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await supabase(),
    {
      data: { user },
    } = await db.auth.getUser();
  if (
    !user ||
    !envAllowsSuperAdmin(
      user.email,
      user.email_confirmed_at,
      process.env.SUPER_ADMIN_EMAILS,
    )
  )
    return { message: "Chỉ super admin được cấu hình." };
  const p = z
    .object({
      g: z.uuid(),
      revision: z.string().regex(/^\d+$/),
      status: z.enum(["approved", "rejected", "revoked"]),
      provider: z.enum(["google", "anthropic", "openai-compatible"]),
      model: z.string().trim().min(1).max(120),
      base_url: z.url().or(z.literal("")),
      key: z.string().trim().max(4000),
      suffix: z.string().max(4),
      message_limit: z.coerce.number().int().min(1).max(500),
      token_limit: z.coerce.number().int().min(1000).max(10000000),
      reason: z.string().trim().min(1).max(500),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success)
    return { message: "Kiểm tra provider, model, hạn mức và lý do." };
  const v = p.data;
  if (v.provider === "openai-compatible") {
    try {
      const u = new URL(v.base_url);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.port ||
        !(process.env.AI_ALLOWED_COMPATIBLE_HOSTS || "api.openai.com")
          .split(",")
          .includes(u.hostname)
      )
        return { message: "Host provider chưa được cho phép trên server." };
    } catch {
      return { message: "Cần URL provider HTTPS hợp lệ." };
    }
  }
  let envelope = null;
  try {
    if (v.status === "approved" && v.key)
      envelope = encryptGroupKey(
        v.g,
        v.key,
        process.env.AI_KEY_ENCRYPTION_SECRET || "",
      );
  } catch {
    return { message: "Chưa có khóa mã hóa hợp lệ trên server." };
  }
  const { error } = await db.rpc("configure_group_ai", {
    g: v.g,
    expected_revision: v.revision,
    configuration: {
      status: v.status,
      provider: v.provider,
      model: v.model,
      base_url: v.base_url,
      suffix: v.key ? v.key.slice(-4) : v.suffix,
      enabled: form.has("enabled"),
      message_limit: v.message_limit,
      token_limit: v.token_limit,
      reason: v.reason,
    },
    envelope,
  });
  if (error)
    return {
      message:
        "Chưa lưu được. Tải lại cấu hình hoặc bổ sung key riêng cho nhóm.",
    };
  revalidatePath("/ai/settings");
  return { ok: true, message: "Đã cập nhật cấu hình AI của nhóm." };
}
