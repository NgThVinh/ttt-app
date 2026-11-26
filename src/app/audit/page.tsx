import Link from "@/components/app-link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
const entrySchema = z.object({
  id: z.uuid(),
  created_at: z.string(),
  group_id: z.uuid().nullable(),
  group_name: z.string().nullable(),
  session_id: z.uuid().nullable(),
  session_title: z.string().nullable(),
  actor_name: z.string(),
  action: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
const labels: Record<string, string> = {
  session_deleted: "Xóa buổi chưa chốt",
  session_created: "Tạo buổi chơi",
  session_updated: "Sửa thông tin buổi",
  money_recalculated: "Tính lại chi phí",
  collector_claimed: "Nhận tính tiền",
  ai_enabled: "Bật AI",
  ai_disabled: "Tắt AI",
  ai_configured: "Cấu hình AI",
  profile_updated: "Cập nhật hồ sơ",
  data_insert: "Thêm dữ liệu",
  data_update: "Cập nhật dữ liệu",
  data_delete: "Xóa dữ liệu",
  member_joined: "Tham gia nhóm",
  invite_created: "Tạo lời mời",
  polls_retired: "Ngừng tính năng Hẹn lịch",
};
const entities: Record<string, string> = {
  groups: "Nhóm",
  group_members: "Thành viên",
  profiles: "Hồ sơ",
  invites: "Lời mời",
  sessions: "Buổi chơi",
  session_attendees: "Người tham gia",
  expenses: "Chi phí",
  expense_allocations: "Phần tiền",
  settlements: "Thanh toán",
  approval_requests: "Yêu cầu",
  notifications: "Thông báo",
  group_ai_settings: "Cài đặt AI",
  ai_runs: "Lượt dùng AI",
  ai_drafts: "Bản nháp AI",
  group_expense_categories: "Loại chi phí",
  expense_templates: "Mẫu chi phí",
  weekly_series: "Lịch lặp",
  payment_evidence: "Bằng chứng thanh toán",
  expense_receipts: "Hóa đơn",
  push_subscriptions: "Đăng ký thông báo",
};
export default async function Audit({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; before?: string; id?: string }>;
}) {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const access = await db.rpc("can_view_audit");
  if (access.error || access.data !== true) notFound();
  const q = await searchParams;
  const query = z
    .object({
      group: z.uuid().or(z.literal("")).optional(),
      before: z.iso.datetime({ offset: true }).optional(),
      id: z.uuid().optional(),
    })
    .refine((v) => !!v.before === !!v.id)
    .safeParse(q);
  const directory = await db.rpc("audit_groups");
  const groups = z
    .array(z.object({ id: z.uuid(), name: z.string() }))
    .safeParse(directory.data);
  const result = query.success
    ? await db.rpc("admin_audit_page", {
        target_group: query.data.group || null,
        before_time: query.data.before || null,
        before_id: query.data.id || null,
        page_size: 31,
      })
    : { data: null, error: { message: "invalid" } };
  const parsed = z.array(entrySchema).safeParse(result.data);
  const entries = parsed.success ? parsed.data.slice(0, 30) : [];
  const last = entries.at(-1);
  const next = last
    ? new URLSearchParams({
        ...(q.group ? { group: q.group } : {}),
        before: last.created_at,
        id: last.id,
      }).toString()
    : "";
  return (
    <main className="audit-page">
      <div className="page-heading">
        <div>
          <h1>Nhật ký hoạt động</h1>
        </div>
      </div>
      <form className="audit-filter" action="/audit">
        <label htmlFor="audit-group">Nhóm</label>
        <select id="audit-group" name="group" defaultValue={q.group || ""}>
          <option value="">Tất cả nhóm được phép xem</option>
          {groups.success &&
            groups.data.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
        </select>
        <button type="submit" className="secondary">
          Lọc
        </button>
        {q.before && (
          <Link href={q.group ? "/audit?group=" + q.group : "/audit"}>
            Mới nhất
          </Link>
        )}
      </form>
      {(result.error || !parsed.success || directory.error) && (
        <p role="alert">Chưa tải được nhật ký. Kiểm tra bộ lọc và thử lại.</p>
      )}
      {parsed.success && !entries.length && (
        <p>Chưa có hoạt động trong phạm vi này.</p>
      )}
      <ol className="audit-list">
        {entries.map((e) => (
          <li key={e.id}>
            <div className="audit-entry-heading">
              <strong>
                {labels[e.action] || e.action.replaceAll("_", " ")}
              </strong>
              <time dateTime={e.created_at}>
                {new Intl.DateTimeFormat("vi-VN", {
                  dateStyle: "short",
                  timeStyle: "medium",
                  timeZone: "Asia/Ho_Chi_Minh",
                }).format(new Date(e.created_at))}
              </time>
            </div>
            <p>
              <strong>{e.actor_name}</strong> · {e.group_name || "Tài khoản"}
              {e.session_title ? " · " + e.session_title : ""}
              {typeof e.payload.table === "string"
                ? " · " + (entities[e.payload.table] || e.payload.table)
                : ""}
            </p>
            {typeof e.payload.reason === "string" && <p>{e.payload.reason}</p>}
            <details>
              <summary>Chi tiết hoạt động</summary>
              <pre>{JSON.stringify(e.payload, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ol>
      {parsed.success && parsed.data.length > 30 && (
        <Link className="secondary audit-next" href={"/audit?" + next}>
          Nhật ký cũ hơn
        </Link>
      )}
    </main>
  );
}
export const metadata = { title: "Nhật ký hoạt động" };
