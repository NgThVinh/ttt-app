import { tool, type ToolSet } from "ai";
import { z } from "zod";
const families = {
  debts: [
    "get_my_debts",
    "get_who_owes_me",
    "draft_mark_paid",
    "request_confirm_received",
    "draft_reminder",
  ],
  sessions: [
    "list_sessions",
    "get_upcoming",
    "get_session_breakdown",
    "draft_rsvp",
    "draft_claim_collector",
    "request_session_change",
  ],
  expenses: ["get_session_breakdown", "list_sessions", "draft_expense"],
  create: ["draft_session", "list_sessions", "get_group_summary"],
  group: ["get_group_summary"],
} as const;
export type Family = keyof typeof families;
export function initialFamilies(message: string): Family[] {
  const text = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase();
  const result = new Set<Family>();
  if (
    /no\b|thu tien|tra tien|chuyen|thanh toan|nhan tien|nhan khoan|nhac|sao ke/.test(
      text,
    )
  )
    result.add("debts");
  if (/phu phi|nuoc|khoan chi|giam gia|chia tien|chia deu|nguoi ung/.test(text))
    result.add("expenses");
  if (/tao buoi|tao lich|hen truoc|hen lich|toi nay san/.test(text))
    result.add("create");
  if (
    /buoi|lich choi|tham gia|toi di|khong di|rut|he so|tinh tien/.test(text) &&
    !result.has("create") &&
    !result.has("expenses")
  )
    result.add("sessions");
  if (/nhom|thanh vien|tong quan/.test(text) && !result.size)
    result.add("group");
  return result.size ? [...result] : ["group"];
}
/** Selection reduces provider input; discovery recovers mismatches. It never grants authority. */
export function toolPalette(
  definitions: ToolSet,
  message: string,
  preferred?: Family[],
) {
  const enabled = new Set<string>(["discover_tools"]);
  function add(family: Family | "all") {
    for (const name of family === "all"
      ? Object.keys(definitions)
      : families[family])
      if (Object.hasOwn(definitions, name)) enabled.add(name);
  }
  (preferred?.length ? preferred : initialFamilies(message)).forEach(add);
  const tools: ToolSet = {
    ...definitions,
    discover_tools: tool({
      description:
        "Mở thêm tool nếu chưa có công cụ cần thiết: debts=công nợ/thanh toán; sessions=buổi/RSVP; expenses=phụ phí; create=tạo buổi; group=nhóm; all=tất cả công cụ được đăng ký. Không thực hiện nghiệp vụ.",
      inputSchema: z.object({
        family: z.enum([
          "debts",
          "sessions",
          "expenses",
          "create",
          "group",
          "all",
        ]),
      }),
      execute: async ({ family }) => {
        add(family);
        return { available: [...enabled] };
      },
    }),
  };
  return { tools, prepareStep: async () => ({ activeTools: [...enabled] }) };
}
