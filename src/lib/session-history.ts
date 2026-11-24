import { z } from "zod";
export const historyItemSchema = z.object({
  id: z.uuid(),
  created_at: z.string(),
  action: z.string(),
  reason: z.string().nullable(),
  actor_name: z.string(),
});
export const historyPageSchema = z.object({
  items: z.array(historyItemSchema),
  has_more: z.boolean(),
});
export type HistoryItem = z.infer<typeof historyItemSchema>;
export const historyLabels: Record<string, string> = {
  session_metadata_updated: "Sửa thông tin buổi",
  session_cancelled: "Hủy buổi",
  session_reopened: "Mở lại buổi",
  rsvp_reset: "Mời xác nhận lại sau khi đổi lịch",
  approval_requested: "Gửi yêu cầu duyệt",
  approval_approved: "Duyệt yêu cầu",
  approval_rejected: "Từ chối yêu cầu",
  collector_transfer_consented: "Đồng ý đổi người tính tiền",
  committed_going: "Nhận lời tham gia",
  committed_not_going: "Chọn không đi",
  added_by_collector: "Mời người tham gia",
  added: "Mời người tham gia",
  join_approved: "Thêm người tham gia",
  removed: "Rút khỏi buổi",
  leave_approved: "Rút khỏi buổi",
  weight_changed: "Đổi hệ số",
  weight_approved: "Duyệt hệ số",
  money_recalculated: "Tính lại tiền",
  session_created: "Tạo buổi",
  confirm: "Xác nhận đã nhận tiền",
  mark: "Báo đã chuyển",
  collector_claimed: "Nhận vai trò tính tiền",
  session_member_invited: "Gửi lời mời tham gia",
  expense_saved: "Lưu khoản chi",
};
