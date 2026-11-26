"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { encryptGroupKey } from "@/lib/ai/crypto";
import type { FormResult } from "@/components/action-form";
export async function toggleAI(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const input = z
    .object({
      g: z.uuid(),
      revision: z.string().regex(/^\d+$/),
      enabled: z.enum(["true", "false"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Thông tin bật/tắt không hợp lệ." };
  const db = await supabase();
  const { error } = await db.rpc("set_group_ai_enabled", {
    g: input.data.g,
    expected_revision: input.data.revision,
    enabled: input.data.enabled === "true",
  });
  if (error)
    return {
      message:
        "Chưa đổi được. Kiểm tra quyền admin, cấu hình key và tải lại nếu dữ liệu đã thay đổi.",
    };
  revalidatePath("/ai", "layout");
  revalidatePath("/audit");
  return {
    ok: true,
    message:
      input.data.enabled === "true"
        ? "Đã bật AI cho nhóm."
        : "Đã tắt AI cho nhóm.",
  };
}
export async function configureDecisionRouting(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await supabase(),
    {
      data: { user },
    } = await db.auth.getUser();
  if (!user) return { message: "Cần đăng nhập." };
  const input = z
    .object({
      g: z.uuid(),
      revision: z.string().regex(/^-?\d+$/),
      model: z.enum([
        "",
        "perplexity/pplx-decider-flash-v1.3:free",
        "perplexity/pplx-decider-v1.3:free",
      ]),
      reason: z.string().trim().min(1).max(500),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Kiểm tra model và lý do." };
  const p = input.data;
  const { error } = await db.rpc("configure_group_decisions", {
    g: p.g,
    expected_revision: p.revision,
    model_id: p.model || null,
    reason: p.reason,
  });
  if (error)
    return { message: "Nhóm cần bật OpenRouter. Tải lại nếu cấu hình đã đổi." };
  revalidatePath("/ai/settings");
  return { ok: true, message: "Đã cập nhật định tuyến ý định của nhóm." };
}
export async function configureAI(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await supabase(),
    {
      data: { user },
    } = await db.auth.getUser();
  if (!user) return { message: "Cần đăng nhập." };
  const p = z
    .object({
      g: z.uuid(),
      revision: z.string().regex(/^-?\d+$/),
      status: z.enum(["approved", "revoked"]),
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
        !(
          process.env.AI_ALLOWED_COMPATIBLE_HOSTS ||
          "api.openai.com,openrouter.ai"
        )
          .split(",")
          .includes(u.hostname)
      )
        return { message: "Địa chỉ dịch vụ AI chưa được hỗ trợ." };
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
    return { message: "Chưa thể lưu cấu hình AI. Liên hệ quản trị ứng dụng." };
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
