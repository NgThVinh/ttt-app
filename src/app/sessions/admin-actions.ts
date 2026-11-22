"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { detailSchema } from "@/lib/session-data";
import type { FormResult } from "@/components/action-form";
async function identity() {
  const db = await supabase();
  if (!(await db.auth.getUser()).data.user) redirect("/login");
  return db;
}
const schema = z.object({
  sid: z.uuid(),
  revision: z.string().regex(/^\d+$/),
  command: z.enum([
    "add_expense",
    "save_expense",
    "apply_financial_change",
    "finish_session",
    "payment_action",
    "assign_guest_collector",
    "apply_request",
  ]),
  body: z.record(z.string(), z.unknown()),
  reason: z.string().trim().min(1).max(500),
  source_id: z.uuid().nullable(),
});
export async function previewAdmin(
  _state: { message: string },
  form: FormData,
) {
  const db = await identity();
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("payload")));
  } catch {
    return { message: "Thông tin dự phòng không hợp lệ." };
  }
  const input = schema.safeParse(raw);
  if (!input.success)
    return { message: "Kiểm tra nội dung, lý do và yêu cầu làm căn cứ." };
  const p = input.data;
  const { data, error } = await db.rpc("preview_admin_financial", {
    sid: p.sid,
    expected_revision: p.revision,
    command: p.command,
    body: p.body,
    reason: p.reason,
    source_id: p.source_id,
  });
  if (error)
    return {
      message:
        "Chưa đủ điều kiện dự phòng hoặc dữ liệu đã đổi. Kiểm tra người tính tiền, mốc 72 giờ, trạng thái khóa và thông tin thao tác.",
    };
  const parsed = z
    .object({
      id: z.uuid(),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      detail: detailSchema,
    })
    .safeParse(data);
  return parsed.success
    ? {
        ...parsed.data,
        payload: String(form.get("payload")),
        message:
          "Bản xem trước chưa lưu tiền. Chỉ xác nhận sau khi kiểm tra lại; bản này có hiệu lực 15 phút.",
      }
    : { message: "Bản xem trước không hợp lệ." };
}
export async function applyAdmin(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const p = z
    .object({ id: z.uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { message: "Bản xem trước không hợp lệ." };
  const { error } = await db.rpc("apply_admin_financial", {
    request_id: p.data.id,
    expected_hash: p.data.hash,
  });
  if (error)
    return {
      message:
        "Chưa lưu được: bản xem trước hết hạn, điều kiện hoặc buổi đã đổi. Hãy xem trước lại.",
    };
  revalidatePath("/sessions", "layout");
  revalidatePath("/approvals");
  revalidatePath("/debts");
  revalidatePath("/notifications");
  return {
    ok: true,
    message: "Đã thực hiện dự phòng, lưu lý do công khai và báo cho nhóm.",
  };
}
export async function unlockSession(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const p = z
    .object({
      sid: z.uuid(),
      revision: z.string().regex(/^\d+$/),
      reason: z.string().trim().min(1).max(500),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { message: "Cần buổi hợp lệ và lý do mở khóa." };
  const { error } = await db.rpc("unlock_session", {
    sid: p.data.sid,
    expected_revision: p.data.revision,
    reason: p.data.reason,
  });
  if (error)
    return {
      message:
        "Không mở khóa được. Kiểm tra quyền admin, trạng thái khóa và tải lại buổi.",
    };
  revalidatePath(`/sessions/${p.data.sid}`);
  return {
    ok: true,
    message:
      "Đã mở khóa trong 24 giờ. Người tính tiền vẫn giữ quyền xử lý tiền.",
  };
}
