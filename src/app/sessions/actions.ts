"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { expenseInputSchema } from "@/lib/session-data";
import { moneySchema } from "@/lib/schemas";
import type { FormResult } from "@/components/action-form";
import { detailSchema } from "@/lib/session-data";
async function identity() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  return db;
}
export async function createSession(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const input = z
    .object({
      groupId: z.uuid(),
      title: z.string().trim().min(1).max(160),
      venue: z.string().trim().min(1).max(200),
      starts: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      commitDeadline: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
        .or(z.literal(""))
        .optional(),
      flow: z.enum(["played", "planned"]),
      court: moneySchema,
    })
    .safeParse(Object.fromEntries(form));
  const ids = z.array(z.uuid()).max(100).safeParse(form.getAll("people"));
  if (!input.success || !ids.success)
    return { message: "Kiểm tra thông tin và số tiền của buổi." };
  if (input.data.flow === "played" && form.get("reviewed") !== "yes")
    return { message: "Vui lòng xem trước bảng chia trước khi lưu." };
  const start = new Date(input.data.starts + ":00+07:00");
  if (!Number.isFinite(start.getTime()))
    return { message: "Ngày giờ không hợp lệ." };
  const deadline = input.data.commitDeadline
    ? new Date(input.data.commitDeadline + ":00+07:00")
    : start;
  if (!Number.isFinite(deadline.getTime()) || deadline > start)
    return { message: "Hạn chốt cần không muộn hơn giờ bắt đầu." };
  const { data, error } = await db.rpc("create_session", {
    g: input.data.groupId,
    title_text: input.data.title,
    venue_text: input.data.venue,
    start_time: start.toISOString(),
    deadline: deadline.toISOString(),
    already_played: input.data.flow === "played",
    people: input.data.flow === "played" ? ids.data : [],
    court: input.data.court,
    be_collector: input.data.flow === "played" || form.has("collector"),
  });
  if (error)
    return {
      message:
        "Chưa tạo được: kiểm tra ngân hàng của người tính tiền, thời gian và danh sách tham gia.",
    };
  redirect(`/sessions/${data}`);
}
export async function sessionCommand(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const input = z
    .object({
      sid: z.uuid(),
      revision: z.string().regex(/^\d+$/),
      operation: z.enum(["going", "not_going", "claim", "finish"]),
      court: moneySchema.optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Thông tin buổi không hợp lệ." };
  const p = input.data;
  if (p.operation === "finish" && form.get("reviewed") !== "yes")
    return { message: "Vui lòng xem trước bảng chia trước khi chốt tiền sân." };
  const { error } =
    p.operation === "going" || p.operation === "not_going"
      ? await db.rpc("set_rsvp", { sid: p.sid, going: p.operation === "going" })
      : await db.rpc(
          p.operation === "claim" ? "claim_collector" : "finish_session",
          { sid: p.sid, expected_revision: p.revision, court: p.court || "0" },
        );
  if (error)
    return {
      message:
        "Chưa thực hiện được. Kiểm tra hạn chốt, ngân hàng, quyền và tải lại buổi nếu dữ liệu đã đổi.",
    };
  revalidatePath(`/sessions/${p.sid}`);
  return { ok: true, message: "Đã cập nhật buổi." };
}
export async function addExpense(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  let value: unknown;
  try {
    value = JSON.parse(String(form.get("payload")));
  } catch {
    return { message: "Dữ liệu không hợp lệ." };
  }
  const parsed = expenseInputSchema.safeParse(value);
  if (!parsed.success)
    return { message: "Kiểm tra lại khoản chi và các phần chia." };
  const p = parsed.data;
  const { error } = await db.rpc("add_expense", {
    sid: p.sid,
    expected_revision: p.revision,
    title_text: p.title,
    raw_amount: p.amount,
    payer: p.payer,
    beneficiaries: p.beneficiaries,
    mode: p.mode,
    split: p.split,
    values_text: p.values,
    reason: p.reason,
  });
  if (error)
    return {
      message:
        "Không lưu được. Dữ liệu hoặc quyền có thể đã đổi; tải lại và xem trước lần nữa.",
    };
  revalidatePath(`/sessions/${p.sid}`);
  revalidatePath("/debts");
  return { ok: true, message: "Đã lưu khoản chi và tính lại công nợ." };
}
export async function changePayment(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const input = z
    .object({ id: z.uuid(), operation: z.enum(["mark", "confirm"]) })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Khoản thanh toán không hợp lệ." };
  const { error } = await db.rpc("payment_action", {
    target: input.data.id,
    operation: input.data.operation,
  });
  if (error)
    return { message: "Khoản đã thay đổi hoặc bạn không có quyền thực hiện." };
  revalidatePath("/sessions", "layout");
  revalidatePath("/debts");
  return {
    ok: true,
    message:
      input.data.operation === "mark"
        ? "Đã báo chuyển; đang chờ người nhận xác nhận."
        : "Đã xác nhận nhận tiền.",
  };
}

const changeSchema = z
  .object({
    sid: z.uuid(),
    revision: z.string().regex(/^\d+$/),
    action: z.enum(["attendee", "delete_expense"]),
    body: z.object({
      reason: z.string().trim().min(1).max(500),
      member_id: z.uuid().optional(),
      operation: z.enum(["add", "remove", "weight"]).optional(),
      weight: z
        .string()
        .regex(/^\d+(\.\d{1,6})?$/)
        .optional(),
      expense_id: z.uuid().optional(),
    }),
  })
  .refine((v) =>
    v.action === "attendee"
      ? !!v.body.member_id && !!v.body.operation
      : !!v.body.expense_id,
  );
function parseChange(form: FormData) {
  try {
    return changeSchema.safeParse(JSON.parse(String(form.get("payload"))));
  } catch {
    return changeSchema.safeParse(null);
  }
}
export async function previewChange(
  _state: { message: string },
  form: FormData,
) {
  const db = await identity();
  const input = parseChange(form);
  if (!input.success) return { message: "Kiểm tra lại thông tin thay đổi." };
  const p = input.data;
  const { data, error } = await db.rpc("preview_financial_change", {
    sid: p.sid,
    expected_revision: p.revision,
    action_name: p.action,
    body: p.body,
  });
  if (error)
    return {
      message:
        "Chưa xem trước được: kiểm tra người tham gia, phần chia chính xác/phần trăm, trạng thái khóa và phiên bản buổi.",
    };
  const parsed = detailSchema.safeParse(data);
  if (!parsed.success) return { message: "Bản xem trước chưa hợp lệ." };
  return {
    message: "Đây là bản xem trước, chưa lưu thay đổi.",
    detail: parsed.data,
    payload: String(form.get("payload")),
  };
}
export async function applyChange(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const input = parseChange(form);
  if (!input.success) return { message: "Thông tin thay đổi không hợp lệ." };
  const p = input.data;
  const { error } = await db.rpc("apply_financial_change", {
    sid: p.sid,
    expected_revision: p.revision,
    action_name: p.action,
    body: p.body,
  });
  if (error)
    return {
      message:
        "Chưa lưu được. Buổi có thể đã thay đổi; tải lại và xem trước lần nữa.",
    };
  revalidatePath(`/sessions/${p.sid}`);
  revalidatePath("/debts");
  return {
    ok: true,
    message: "Đã lưu thay đổi, giữ lịch sử và tính lại công nợ.",
  };
}
