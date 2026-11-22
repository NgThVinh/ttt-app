import "server-only";
import { z } from "zod";
import type { supabase } from "@/lib/supabase";
import { internalSupabase } from "@/lib/internal-supabase";
import { decryptGroupKey } from "./crypto";
import { groupModel } from "./providers";
import { generationLimits } from "./generation-limits";
import { probeDecision } from "./harness/decision-router.mjs";
const settingsSchema = z.object({
  status: z.literal("approved"),
  enabled: z.literal(true),
  provider: z.enum(["google", "anthropic", "openai-compatible"]),
  model: z.string().min(1),
  base_url: z.string().nullable(),
  decision_model: z
    .enum([
      "perplexity/pplx-decider-flash-v1.3:free",
      "perplexity/pplx-decider-v1.3:free",
    ])
    .nullable()
    .default(null),
});
/** Kept outside business tools. No caller can choose an actor or access plaintext. */
export async function agentForUserGroup(
  db: Awaited<ReturnType<typeof supabase>>,
  group: string,
) {
  if (process.env.AI_KILL_SWITCH === "1") throw Error("AI đang tạm tắt.");
  z.uuid().parse(group);
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw Error("Cần đăng nhập.");
  const membership = await db
    .from("group_members")
    .select("id")
    .eq("group_id", group)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (membership.error || !membership.data)
    throw Error("Không có quyền truy cập nhóm.");
  const result = await db
    .from("group_ai_settings")
    .select("status,enabled,provider,model,base_url,decision_model")
    .eq("group_id", group)
    .single();
  const settings = settingsSchema.safeParse(result.data);
  if (result.error || !settings.success) throw Error("Nhóm chưa bật AI.");
  const { data, error } = await internalSupabase().rpc("read_ai_credential", {
    g: group,
  });
  if (error || !data) throw Error("Nhóm chưa có key AI hoạt động.");
  const key = decryptGroupKey(
    group,
    data,
    process.env.AI_KEY_ENCRYPTION_SECRET || "",
  );
  const decision =
    settings.data.provider === "openai-compatible" &&
    settings.data.base_url === "https://openrouter.ai/api/v1" &&
    settings.data.decision_model;
  return {
    model: () => groupModel(settings.data, key),
    generation: generationLimits(settings.data.provider, settings.data.model),
    decision: decision
      ? async (message: string, signal: AbortSignal) =>
          probeDecision(key, decision, message, { signal })
      : null,
  };
}
export async function modelForUserGroup(
  db: Awaited<ReturnType<typeof supabase>>,
  group: string,
) {
  return (await agentForUserGroup(db, group)).model();
}
