"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { expenseInputSchema, expenseDraftSchema } from "@/lib/session-data";
import {
  courtInputSchema,
  vndInputSchema,
  weightInputSchema,
} from "@/lib/number-input";
import type { FormResult } from "@/components/action-form";
import { detailSchema } from "@/lib/session-data";
import { runFinancialCommand } from "@/lib/financial-command";
import { meetingSchema } from "@/lib/meeting";
import { expenseToolsSchema, expenseEditorSchema } from "@/lib/expense-tools";
import {
  sessionCalendarFormSchema,
  sessionCalendarSchema,
} from "@/lib/session-calendar";
async function identity() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  return db;
}
export async function scheduleMeeting(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const parsed = meetingSchema.safeParse({
    ...Object.fromEntries(form),
    invitees: form.getAll("invitees"),
  });
  if (!parsed.success) return { message: parsed.error.issues[0].message };
  const p = parsed.data;
  const { data, error } = await db.rpc("schedule_meeting", {
    request_key: p.request_key,
    body: {
      g: p.groupId,
      title_text: p.title,
      venue_text: p.venue,
      start_time: p.starts,
      ends_at: p.ends,
      deadline: p.starts,
      note: p.note,
      be_collector: p.collectorMode === "self",
      nominee: p.collectorMode === "nominee" ? p.nominee : "",
      invitees: p.invitees,
    },
  });
  const result = z.object({ id: z.uuid() }).safeParse(data);
  if (error?.code === "PGRST202" || error?.code === "42883")
    return {
      message:
        "Chưa lưu lịch: hệ thống chưa cập nhật chức năng đặt lịch. Hãy báo quản trị ứng dụng; thông tin bạn nhập vẫn được giữ.",
    };
  if (error || !result.success)
    return {
      message: error?.message?.includes("ngân hàng")
        ? "Chưa lưu: bổ sung ngân hàng trong Hồ sơ trước khi nhận tính tiền."
        : "Chưa lưu lịch. Kiểm tra giờ trong tương lai, thành viên được mời và thử lại.",
    };
  for (const path of ["/", "/sessions", "/notifications"]) revalidatePath(path);
  redirect(`/sessions/${result.data.id}`);
}
export async function inviteToSession(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const parsed = z
    .object({ sid: z.uuid(), people: z.array(z.uuid()).min(1).max(100) })
    .safeParse({ sid: form.get("sid"), people: form.getAll("people") });
  if (!parsed.success)
    return { message: "Chọn ít nhất một thành viên trong nhóm." };
  const { error } = await db.rpc("invite_session_members", parsed.data);
  if (error)
    return {
      message:
        "Chưa mời được. Buổi có thể đã chốt chi phí hoặc thành viên không còn trong nhóm.",
    };
  revalidatePath(`/sessions/${parsed.data.sid}`);
  revalidatePath("/notifications");
  return {
    ok: true,
    message: "Đã gửi lời mời. Người được mời cần tự nhận lời tham gia.",
  };
}
export async function manageSession(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const base = sessionCalendarFormSchema.safeParse(Object.fromEntries(form));
  const operation = form.get("operation");
  const body =
    operation === "cancel"
      ? { reason: form.get("reason") }
      : {
          title: form.get("title"),
          venue: form.get("venue"),
          note: form.get("note"),
          starts_at: form.get("starts_at"),
          ...(form.has("ends_at") ? { ends_at: form.get("ends_at") } : {}),
          commit_deadline: form.get("commit_deadline"),
          reason: form.get("reason"),
        };
  const input = sessionCalendarSchema.safeParse({ operation, body });
  if (!base.success || !input.success)
    return { message: "Kiểm tra tên, địa điểm, ngày giờ, hạn chốt và lý do." };
  if (operation === "cancel" && form.get("reviewed") !== "yes")
    return { message: "Vui lòng xác nhận hủy riêng buổi này." };
  const { error } = await db.rpc("manage_session", {
    sid: base.data.sid,
    expected_revision: base.data.revision,
    operation_name: input.data.operation,
    body: input.data.body,
  });
  if (error)
    return {
      message:
        "Chưa lưu được. Kiểm tra quyền, hạn chốt và lịch sử tiền; tải lại nếu buổi đã thay đổi.",
    };
  revalidatePath(`/sessions/${base.data.sid}`);
  revalidatePath("/sessions");
  revalidatePath("/notifications");
  revalidatePath("/");
  revalidatePath("/approvals");
  return {
    ok: true,
    message:
      operation === "cancel"
        ? "Đã hủy buổi, giữ nguyên lịch sử."
        : operation === "reopen"
          ? "Đã mở lại. Mọi người cần tự chốt tham gia."
          : "Đã cập nhật thông tin buổi và báo cho nhóm.",
  };
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
      court: courtInputSchema,
      collectorMode: z.enum(["self", "unknown", "nominee"]).default("self"),
      nominee: z.uuid().or(z.literal("")).default(""),
    })
    .safeParse(Object.fromEntries(form));
  const ids = z.array(z.uuid()).max(100).safeParse(form.getAll("people"));
  if (!input.success)
    return {
      message:
        input.error.issues.find((issue) => issue.path[0] === "court")
          ?.message || "Kiểm tra thông tin của buổi.",
    };
  if (!ids.success)
    return { message: "Kiểm tra thông tin và số tiền của buổi." };
  let extras, weights;
  try {
    extras = z
      .array(expenseDraftSchema.extend({ amount: vndInputSchema }))
      .max(199)
      .parse(JSON.parse(String(form.get("extras") || "[]")));
    weights = z
      .record(z.uuid(), weightInputSchema)
      .parse(JSON.parse(String(form.get("weights") || "{}")));
  } catch {
    return { message: "Kiểm tra phụ phí và hệ số tham gia." };
  }
  if (
    input.data.flow === "planned" &&
    input.data.collectorMode === "nominee" &&
    !input.data.nominee
  )
    return { message: "Chọn người được đề cử tính tiền." };
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
  const { data, error } = await runFinancialCommand(
    db,
    form.get("request_key"),
    "create_session_bundle",
    {
      g: input.data.groupId,
      title_text: input.data.title,
      venue_text: input.data.venue,
      start_time: start.toISOString(),
      deadline: deadline.toISOString(),
      already_played: input.data.flow === "played",
      people: input.data.flow === "played" ? ids.data : [],
      court: input.data.court,
      be_collector:
        input.data.flow === "played" || input.data.collectorMode === "self",
      nominee:
        input.data.flow === "planned" && input.data.collectorMode === "nominee"
          ? input.data.nominee
          : "",
      weights: input.data.flow === "played" ? weights : {},
      extras:
        input.data.flow === "played"
          ? extras.map((e) => ({
              expense_id: "",
              category_id: e.category_id,
              note_text: e.note,
              title_text: e.title,
              raw_amount: e.amount,
              payer: e.payer,
              beneficiaries: e.beneficiaries,
              mode: e.mode,
              split: e.split,
              values_text: e.values,
              reason: e.reason,
            }))
          : [],
    },
  );
  const created = z.object({ id: z.uuid() }).safeParse(data);
  if (error?.message?.includes("ngân hàng"))
    return {
      message:
        "Chưa lưu buổi: người tính tiền cần đủ ngân hàng, số tài khoản và tên chủ tài khoản trong Hồ sơ. Dữ liệu form vẫn được giữ; cập nhật hồ sơ rồi thử lại.",
    };
  if (error || !created.success)
    return {
      message:
        "Chưa tạo được: kiểm tra ngân hàng của người tính tiền, thời gian và danh sách tham gia.",
    };
  revalidatePath("/sessions");
  revalidatePath("/");
  revalidatePath("/debts");
  revalidatePath("/notifications");
  redirect(`/sessions/${created.data.id}`);
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
      court: courtInputSchema.optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Thông tin buổi không hợp lệ." };
  const p = input.data;
  if (p.operation === "finish" && form.get("reviewed") !== "yes")
    return { message: "Vui lòng xem trước bảng chia trước khi chốt tiền sân." };
  const { error } =
    p.operation === "going" || p.operation === "not_going"
      ? await db.rpc("set_rsvp", { sid: p.sid, going: p.operation === "going" })
      : await runFinancialCommand(
          db,
          form.get("request_key"),
          p.operation === "claim" ? "claim_collector" : "finish_session",
          { sid: p.sid, expected_revision: p.revision, court: p.court || "0" },
        );
  if (error)
    return {
      message:
        "Chưa thực hiện được. Buổi có thể đã chốt chi phí hoặc đã thay đổi; kiểm tra ngân hàng và tải lại trước khi thử lại.",
    };
  revalidatePath(`/sessions/${p.sid}`);
  revalidatePath("/sessions");
  revalidatePath("/");
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
  const { error } = await runFinancialCommand(
    db,
    form.get("request_key"),
    "save_expense",
    {
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
      expense_id: p.expense_id,
      category_id: p.category_id,
      note_text: p.note,
    },
  );
  if (error)
    return {
      message:
        "Không lưu được. Dữ liệu hoặc quyền có thể đã đổi; tải lại và xem trước lần nữa.",
    };
  revalidatePath(`/sessions/${p.sid}`);
  revalidatePath("/debts");
  revalidatePath("/approvals");
  return {
    ok: true,
    message:
      "Đã tiếp nhận khoản chi. Khoản đề xuất chỉ tính vào công nợ sau khi được duyệt.",
  };
}
export async function loadExpenseEditor(
  target: unknown,
  administrative = false,
) {
  const db = await identity();
  const id = z.uuid().safeParse(target);
  if (!id.success) return { message: "Khoản chi không hợp lệ." };
  const { data: row, error } = await db
    .from("expenses")
    .select("session_id")
    .eq("id", id.data)
    .single();
  if (error) return { message: "Không có quyền xem khoản chi." };
  const results = await Promise.all([
    db.rpc("session_details", { sid: row.session_id }),
    db.rpc("expense_editor_data", { sid: row.session_id }),
  ]);
  const session = detailSchema.safeParse(results[0].data);
  const entries = z.array(expenseEditorSchema).safeParse(results[1].data);
  if (!session.success || !entries.success)
    return { message: "Không tải được dữ liệu sửa khoản chi." };
  const expense = entries.data.find((e) => e.id === id.data);
  const isAdmin = administrative
    ? (await db.rpc("is_group_admin", { g: session.data.group_id })).data ===
      true
    : false;
  if (!expense || (!expense.can_edit && !isAdmin))
    return { message: "Bạn không có quyền sửa khoản này." };
  const tools = expenseToolsSchema.safeParse(
    (await db.rpc("expense_tools", { g: session.data.group_id })).data,
  );
  return {
    session: session.data,
    expense,
    tools: tools.success ? tools.data : undefined,
  };
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
  const { error } = await runFinancialCommand(
    db,
    form.get("request_key"),
    "payment_action",
    {
      target: input.data.id,
      operation: input.data.operation,
    },
  );
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
  const { error } = await runFinancialCommand(
    db,
    form.get("request_key"),
    "apply_financial_change",
    {
      sid: p.sid,
      expected_revision: p.revision,
      action_name: p.action,
      body: p.body,
    },
  );
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
