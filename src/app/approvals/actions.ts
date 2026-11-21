"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { detailSchema } from "@/lib/session-data";
import type { FormResult } from "@/components/action-form";
async function identity() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  return db;
}
export async function requestChange(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const input = z
    .object({
      sid: z.uuid(),
      kind: z.enum(["join", "leave", "weight", "collector_nomination"]),
      reason: z.string().trim().min(1).max(500),
      member_id: z.uuid().or(z.literal("")).optional(),
      weight: z
        .string()
        .regex(/^\d+(\.\d{1,6})?$/)
        .or(z.literal(""))
        .optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Kiểm tra nội dung và lý do yêu cầu." };
  const p = input.data;
  const { error } = await db.rpc("request_session_change", {
    sid: p.sid,
    kind: p.kind,
    body: {
      reason: p.reason,
      member_id: p.member_id || null,
      weight: p.weight || null,
    },
  });
  if (error)
    return {
      message:
        "Chưa gửi được. Kiểm tra hạn chốt, quyền đề cử, hệ số hoặc yêu cầu đang chờ; hủy yêu cầu cũ nếu cần gửi lại.",
    };
  revalidatePath(`/sessions/${p.sid}`);
  revalidatePath("/approvals");
  return {
    ok: true,
    message:
      "Đã gửi yêu cầu. Thay đổi chỉ có hiệu lực sau khi đúng người duyệt.",
  };
}
const decisionSchema = z.object({
  id: z.uuid(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export async function previewApproval(
  _state: { message: string },
  form: FormData,
) {
  const db = await identity();
  const input = decisionSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Yêu cầu không hợp lệ." };
  const { data, error } = await db.rpc("preview_session_request", {
    request_id: input.data.id,
    expected_hash: input.data.hash,
  });
  if (error)
    return {
      message:
        "Không thể xem trước: yêu cầu hết hạn, buổi đã thay đổi hoặc bạn không còn thẩm quyền. Người gửi cần tạo yêu cầu mới nếu dữ liệu đã đổi.",
    };
  const parsed = detailSchema.safeParse(data);
  if (!parsed.success) return { message: "Bản xem trước không hợp lệ." };
  return { message: "Bản xem trước chưa lưu thay đổi.", detail: parsed.data };
}
export async function decideApproval(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const input = decisionSchema
    .extend({ decision: z.enum(["approve", "reject", "cancel"]) })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Yêu cầu không hợp lệ." };
  const p = input.data;
  const { error } =
    p.decision === "cancel"
      ? await db.rpc("cancel_session_request", { request_id: p.id })
      : await db.rpc("decide_session_request", {
          request_id: p.id,
          approve: p.decision === "approve",
          expected_hash: p.hash,
        });
  if (error)
    return {
      message:
        "Chưa xử lý được. Kiểm tra quyền, phiên bản và hạn dùng; tải lại để xem dữ liệu mới.",
    };
  revalidatePath("/approvals");
  revalidatePath("/sessions", "layout");
  revalidatePath("/debts");
  return {
    ok: true,
    message:
      "Đã xử lý yêu cầu. Đề cử chuyển vai trò có thể còn cần người được đề cử nhận.",
  };
}
