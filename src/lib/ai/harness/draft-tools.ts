import { tool } from "ai";
import { z } from "zod";
import type { supabase } from "@/lib/supabase";
import { expenseInputSchema } from "@/lib/session-data";
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
      inputSchema: expenseInputSchema,
      execute: (e) =>
        draft("expense", {
          sid: e.sid,
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
