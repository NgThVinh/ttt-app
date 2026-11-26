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
export async function weeklySeries(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const input = z
    .object({
      id: z.uuid(),
      operation: z.enum(["start", "stop"]),
      weeks: z.coerce.number().int().min(1).max(12).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Thông tin lịch lặp không hợp lệ." };
  const p = input.data;
  const { error } =
    p.operation === "start"
      ? await db.rpc("set_weekly_series", { sid: p.id, weeks: p.weeks || 4 })
      : await db.rpc("stop_weekly_series", { target: p.id });
  if (error)
    return {
      message:
        "Chưa cập nhật được lịch lặp. Kiểm tra quyền và buổi phải còn ở tương lai.",
    };
  revalidatePath("/sessions", "layout");
  return {
    ok: true,
    message:
      p.operation === "start"
        ? "Đã tạo lịch lặp hàng tuần. Buổi mới chưa gán người tính tiền; mỗi người tự chốt tham gia."
        : "Đã dừng tạo buổi mới. Các buổi đã tạo vẫn giữ nguyên.",
  };
}
