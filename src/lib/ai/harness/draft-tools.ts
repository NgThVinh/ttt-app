import { tool } from "ai";
import { z } from "zod";
import type { supabase } from "@/lib/supabase";
import { expenseDraftSchema } from "@/lib/session-data";
export const aiExpenseInputSchema = expenseDraftSchema
  .extend({
    session_id: z
      .uuid()
      .describe(
        "ID buổi chính xác từ sessions[].id hoặc get_session_breakdown.id; không dùng group/member ID và không tự tạo ID.",
      ),
    revision: z
      .string()
      .regex(/^\d+$/)
      .describe("Revision hiện tại của đúng buổi đã chọn."),
  })
  .refine((v) => new Set(v.beneficiaries).size === v.beneficiaries.length);
export function draftTools(
  db: Awaited<ReturnType<typeof supabase>>,
  group: string,
) {
  async function draft(command: string, body: Record<string, unknown>) {
    const { data, error } = await db.rpc("create_ai_draft", {
      g: group,
      command,
      body,
    });
    if (error)
      throw Error(
        "Chưa tạo được bản nháp. Kiểm tra quyền, nhóm, thời hạn và dữ liệu hiện tại.",
      );
    return data;
  }
  return {
    draft_session: tool({
      description:
        "Tạo bản nháp buổi đã chơi hoặc hẹn trước, gồm người tham gia, hệ số và phụ phí. Ngày giờ ISO có múi giờ. Chưa ghi buổi thật khi chưa xác nhận trong app.",
      inputSchema: z.object({
        title: z.string().trim().min(1).max(160),
        venue: z.string().trim().min(1).max(200),
        starts_at: z.iso.datetime({ offset: true }),
        deadline: z.iso.datetime({ offset: true }),
        already_played: z.boolean(),
        people: z.array(z.uuid()).max(100),
        court: z.string().regex(/^\d+$/),
        be_collector: z.boolean(),
        nominee: z.uuid().or(z.literal("")),
        weights: z.record(z.uuid(), z.string().regex(/^\d+(\.\d{1,6})?$/)),
        extras: z.array(expenseDraftSchema).max(199),
      }),
      execute: (v) =>
        draft("create_session", {
          g: group,
          title_text: v.title,
          venue_text: v.venue,
          start_time: v.starts_at,
          deadline: v.deadline,
          already_played: v.already_played,
          people: v.people,
          court: v.court,
          be_collector: v.be_collector,
          nominee: v.nominee,
          weights: v.weights,
          extras: v.extras.map((e) => ({
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
          })),
        }),
    }),
    draft_poll: tool({
      description:
        "Bản nháp thăm dò nhiều khung giờ tương lai. Người hỏi xác nhận trong app trước khi gửi tới nhóm.",
      inputSchema: z.object({
        title: z.string().trim().min(1).max(160),
        venue: z.string().trim().min(1).max(200),
        minimum: z.number().int().min(1).max(100),
        deadline: z.iso.datetime({ offset: true }),
        options: z
          .array(
            z.object({
              starts_at: z.iso.datetime({ offset: true }),
              ends_at: z.iso.datetime({ offset: true }),
            }),
          )
          .min(1)
          .max(24),
      }),
      execute: (v) =>
        draft("create_poll", {
          g: group,
          title_text: v.title,
          venue_text: v.venue,
          minimum: v.minimum,
          deadline: v.deadline,
          options: v.options,
        }),
    }),
    draft_rsvp: tool({
      description:
        "Tạo bản nháp tự chốt đi/không đi trước hạn. Người hỏi phải mở bản nháp và xác nhận.",
      inputSchema: z.object({ session_id: z.uuid(), going: z.boolean() }),
      execute: ({ session_id, going }) =>
        draft("rsvp", { sid: session_id, going }),
    }),
    draft_vote: tool({
      description: "Tạo bản nháp phiếu của chính người hỏi, không chốt hộ ai.",
      inputSchema: z.object({
        option_id: z.uuid(),
        answer: z.enum(["yes", "maybe", "no"]),
      }),
      execute: (v) => draft("vote", v),
    }),
    draft_mark_paid: tool({
      description:
        "Tạo bản nháp báo tôi đã chuyển cho đúng khoản. Không xác nhận người nhận đã nhận tiền.",
      inputSchema: z.object({ settlement_id: z.uuid() }),
      execute: ({ settlement_id }) =>
        draft("mark_paid", { target: settlement_id }),
    }),
    request_confirm_received: tool({
      description:
        "Yêu cầu xác nhận đã nhận tiền. Luôn T3 và phải kiểm sao kê, duyệt trong app.",
      inputSchema: z.object({ settlement_id: z.uuid() }),
      execute: ({ settlement_id }) =>
        draft("confirm_received", { target: settlement_id }),
    }),
    draft_claim_collector: tool({
      description:
        "Bản nháp tự nhận tính tiền khi chưa có người thu; cần hồ sơ ngân hàng và revision hiện tại.",
      inputSchema: z.object({
        session_id: z.uuid(),
        revision: z.string().regex(/^\d+$/),
        court: z.string().regex(/^\d+$/),
      }),
      execute: ({ session_id, revision, court }) =>
        draft("claim_collector", {
          sid: session_id,
          expected_revision: revision,
          court,
        }),
    }),
    draft_reminder: tool({
      description:
        "Bản nháp nhắc một khoản đang chờ, chỉ người thu có quyền, tối đa một lần mỗi 24 giờ.",
      inputSchema: z.object({ settlement_id: z.uuid() }),
      execute: ({ settlement_id }) =>
        draft("reminder", { target: settlement_id }),
    }),
    draft_expense: tool({
      description:
        "Tạo bản nháp khoản chi theo schema của app. Không tự lưu. Khoản có thu tiền hoặc do người tham gia đề xuất sẽ đi qua T3 trong app.",
      inputSchema: aiExpenseInputSchema,
      execute: (e) =>
        draft("expense", {
          sid: e.session_id,
          expected_revision: e.revision,
          expense_id: e.expense_id,
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
        }),
    }),
    request_session_change: tool({
      description:
        "Tạo yêu cầu rút/thêm chính mình, đổi hệ số hoặc đề cử người tính tiền. Mở app để gửi và duyệt đúng thẩm quyền.",
      inputSchema: z.object({
        session_id: z.uuid(),
        kind: z.enum(["join", "leave", "weight", "collector_nomination"]),
        reason: z.string().min(1).max(500),
        member_id: z.uuid().optional(),
        weight: z
          .string()
          .regex(/^\d+(\.\d{1,6})?$/)
          .optional(),
      }),
      execute: ({ session_id, kind, ...request }) =>
        draft("session_request", { sid: session_id, kind, request }),
    }),
  };
}
