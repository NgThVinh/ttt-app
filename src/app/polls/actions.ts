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
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .transform((v) => new Date(v + ":00+07:00"))
  .refine((v) => Number.isFinite(v.getTime()));
export async function createPoll(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const input = z
    .object({
      group: z.uuid(),
      title: z.string().trim().min(1).max(160),
      venue: z.string().trim().min(1).max(200),
      minimum: z.coerce.number().int().min(1).max(100),
      deadline: date,
    })
    .safeParse(Object.fromEntries(form));
  const starts = z.array(date).min(1).max(24).safeParse(form.getAll("starts")),
    ends = z.array(date).min(1).max(24).safeParse(form.getAll("ends"));
  if (
    !input.success ||
    !starts.success ||
    !ends.success ||
    starts.data.length !== ends.data.length
  )
    return { message: "Kiểm tra thông tin và các khung giờ." };
  const p = input.data;
  const { data, error } = await db.rpc("create_poll", {
    g: p.group,
    title_text: p.title,
    venue_text: p.venue,
    minimum: p.minimum,
    deadline: p.deadline.toISOString(),
    options: starts.data.map((d, i) => ({
      starts_at: d.toISOString(),
      ends_at: ends.data[i].toISOString(),
    })),
  });
  if (error)
    return {
      message:
        "Chưa tạo được. Các khung giờ phải ở tương lai và hạn trả lời không được sau khung đầu tiên.",
    };
  redirect(`/polls/${data}`);
}
export async function votePoll(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const input = z
    .object({ id: z.uuid(), answer: z.enum(["yes", "maybe", "no"]) })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Lựa chọn không hợp lệ." };
  const { error } = await db.rpc("vote_poll", {
    target: input.data.id,
    response: input.data.answer,
  });
  if (error)
    return {
      message:
        "Chưa lưu được: thăm dò có thể đã hết hạn hoặc quyền của bạn đã đổi.",
    };
  revalidatePath("/polls", "layout");
  return {
    ok: true,
    message:
      "Đã lưu lựa chọn. Khi chốt lịch, bạn vẫn cần tự chốt tham gia buổi.",
  };
}
export async function closePoll(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const input = z
    .object({ id: z.uuid(), option: z.uuid() })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Khung giờ không hợp lệ." };
  const { data, error } = await db.rpc("close_poll", {
    target: input.data.id,
    chosen: input.data.option,
  });
  if (error)
    return {
      message:
        "Chưa chốt được: kiểm tra quyền, số người tối thiểu và giờ bắt đầu.",
    };
  redirect(`/sessions/${data}`);
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
