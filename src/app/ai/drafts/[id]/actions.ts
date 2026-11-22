"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import type { FormResult } from "@/components/action-form";
export async function decideDraft(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const p = z
    .object({
      id: z.uuid(),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      decision: z.enum(["approve", "reject"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { message: "Bản nháp không hợp lệ." };
  if (p.data.decision === "approve" && form.get("reviewed") !== "yes")
    return { message: "Hãy xem nội dung và xác nhận trước khi thực thi." };
  const db = await supabase();
  const { error } = await db.rpc("decide_ai_draft", {
    target: p.data.id,
    expected_hash: p.data.hash,
    approve: p.data.decision === "approve",
  });
  if (error)
    return {
      message:
        "Chưa thực hiện. Bản nháp có thể hết hạn, buổi đã đổi hoặc bạn không còn quyền. Tạo yêu cầu mới với dữ liệu hiện tại.",
    };
  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      p.data.decision === "approve"
        ? "Đã thực hiện; xem lại dữ liệu hiện tại trong app."
        : "Đã từ chối.",
  };
}
