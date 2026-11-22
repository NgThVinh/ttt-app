import { tool } from "ai";
import { z } from "zod";
import type { supabase } from "@/lib/supabase";
import { detailSchema } from "@/lib/session-data";
import { groupContext } from "../context/group";
const debtSchema = z.array(
  z.object({
    id: z.uuid(),
    session_id: z.uuid(),
    group_id: z.uuid(),
    session_title: z.string(),
    from_name: z.string(),
    to_name: z.string(),
    amount: z.string().regex(/^\d+$/),
    status: z.string(),
    mine_is_sender: z.boolean(),
    ref_code: z.string().optional(),
  }),
);
/** Business tools receive only the user's SSR client, never an internal client. */
export function readTools(
  db: Awaited<ReturnType<typeof supabase>>,
  group: string,
  userId: string,
) {
  async function check() {
    return groupContext(db, group, userId);
  }
  async function debts(sender: boolean) {
    await check();
    const { data, error } = await db.rpc("my_settlements");
    if (error) throw Error("Chưa tải được công nợ.");
    const rows = debtSchema
      .parse(data)
      .filter(
        (r) =>
          r.group_id === group &&
          r.mine_is_sender === sender &&
          r.status !== "confirmed",
      );
    return {
      total: rows.reduce((a, r) => a + BigInt(r.amount), 0n).toString(),
      rows: rows.map(({ group_id, ...r }) => ({
        ...r,
        href: `/sessions/${r.session_id}`,
      })),
      href: "/debts",
    };
  }
  async function sessions(upcoming: boolean) {
    await check();
    let query = db
      .from("sessions")
      .select("id,title,venue,starts_at,status")
      .eq("group_id", group)
      .neq("status", "cancelled")
      .order("starts_at", { ascending: upcoming })
      .limit(30);
    if (upcoming) query = query.gte("starts_at", new Date().toISOString());
    const { data, error } = await query;
    if (error) throw Error("Chưa tải được buổi chơi.");
    return {
      sessions: data.map((s) => ({ ...s, href: `/sessions/${s.id}` })),
      href: "/sessions",
    };
  }
  return {
    get_my_debts: tool({
      description:
        "Tổng và từng khoản tôi còn cần chuyển trong nhóm đang chọn. Tiền nguyên VND dạng chuỗi.",
      inputSchema: z.object({}),
      execute: () => debts(true),
    }),
    get_who_owes_me: tool({
      description:
        "Các khoản tôi đang chờ người khác thanh toán trong nhóm đang chọn.",
      inputSchema: z.object({}),
      execute: () => debts(false),
    }),
    list_sessions: tool({
      description: "Liệt kê các buổi gần đây của nhóm đang chọn.",
      inputSchema: z.object({}),
      execute: () => sessions(false),
    }),
    get_upcoming: tool({
      description: "Liệt kê buổi sắp tới của nhóm đang chọn.",
      inputSchema: z.object({}),
      execute: () => sessions(true),
    }),
    get_group_summary: tool({
      description: "Thông tin và số thành viên hoạt động của nhóm đang chọn.",
      inputSchema: z.object({}),
      execute: async () => {
        const c = await check();
        return {
          group: c.group,
          active_members: c.members.length,
          href: `/groups/${group}`,
        };
      },
    }),
    get_session_breakdown: tool({
      description:
        "Chi tiết người tham gia, khoản chi, phần chia và tình trạng thanh toán. Chỉ chọn ID buổi trong nhóm hiện tại.",
      inputSchema: z.object({ session_id: z.uuid() }),
      execute: async ({ session_id }) => {
        await check();
        const allowed = await db
          .from("sessions")
          .select("id")
          .eq("id", session_id)
          .eq("group_id", group)
          .maybeSingle();
        if (!allowed.data) throw Error("Buổi không thuộc nhóm đang chọn.");
        const { data, error } = await db.rpc("session_details", {
          sid: session_id,
        });
        if (error) throw Error("Chưa tải được bảng chia.");
        const s = detailSchema.parse(data);
        if (s.group_id !== group) throw Error("Sai nhóm.");
        return {
          id: s.id,
          title: s.title,
          status: s.status,
          attendees: s.attendees,
          expenses: s.expenses.map((e) => ({
            title: e.title,
            amount: e.amount,
            allocations: e.allocations,
          })),
          payments: s.settlements.map((p) => ({
            id: p.id,
            from_name: p.from_name,
            to_name: p.to_name,
            amount: p.amount,
            status: p.status,
          })),
          href: `/sessions/${s.id}`,
        };
      },
    }),
    get_poll_results: tool({
      description:
        "Kết quả thăm dò lịch của nhóm hiện tại, gồm số phiếu theo khung giờ.",
      inputSchema: z.object({ poll_id: z.uuid() }),
      execute: async ({ poll_id }) => {
        await check();
        const poll = await db
          .from("polls")
          .select("id,title,status,closes_at")
          .eq("id", poll_id)
          .eq("group_id", group)
          .maybeSingle();
        if (!poll.data) throw Error("Thăm dò không thuộc nhóm đang chọn.");
        const options = await db
          .from("poll_options")
          .select("id,starts_at")
          .eq("poll_id", poll_id);
        if (options.error) throw Error("Chưa tải được khung giờ.");
        const votes = options.data.length
          ? await db
              .from("poll_votes")
              .select("option_id,answer")
              .in(
                "option_id",
                options.data.map((o) => o.id),
              )
          : { data: [], error: null };
        if (votes.error) throw Error("Chưa tải được phiếu.");
        return {
          poll: poll.data,
          options: options.data.map((o) => ({
            ...o,
            votes: votes.data?.filter((v) => v.option_id === o.id),
          })),
          href: `/polls/${poll_id}`,
        };
      },
    }),
  };
}
