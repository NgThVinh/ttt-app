import { it, expect } from "vitest";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import pg from "pg";
import { generateText, stepCountIs } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { freeFallbackBody } from "./free-fallback.mjs";
import { decryptGroupKey } from "./crypto";
import { systemPrompt, PROMPT_VERSION } from "./prompts/system";
import { readTools } from "./harness/read-tools";
import { draftTools } from "./harness/draft-tools";
import { toolPalette } from "./harness/tool-palette";
import type { supabase } from "@/lib/supabase";
import { databaseUrlForProject } from "../../../scripts/migration-utils.mjs";
const sid = "11111111-1111-4111-8111-111111111111",
  pid = "22222222-2222-4222-8222-222222222222",
  option = "33333333-3333-4333-8333-333333333333",
  payment = "44444444-4444-4444-8444-444444444444";
type Case = { text: string; tool: string; input: Record<string, unknown> };
const cases: Case[] = [];
function add(
  tool: string,
  texts: string[],
  input: Record<string, unknown> = {},
) {
  for (const text of texts) cases.push({ text, tool, input });
}
add("get_my_debts", [
  "Tôi còn nợ ai?",
  "Cho xem các khoản tôi cần trả.",
  "Tổng số tiền tôi đang nợ trong nhóm?",
]);
add("get_who_owes_me", [
  "Ai đang nợ tôi?",
  "Tôi còn phải thu bao nhiêu?",
  "Những ai chưa chuyển cho tôi?",
]);
add("list_sessions", [
  "Liệt kê buổi chơi gần đây.",
  "Xem các buổi vừa rồi.",
  "Nhóm có những buổi nào gần đây?",
]);
add("get_upcoming", [
  "Buổi sắp tới là khi nào?",
  "Xem lịch chơi sắp tới.",
  "Chúng ta có lịch gì tiếp theo?",
]);
add("get_group_summary", [
  "Tóm tắt thông tin nhóm.",
  "Nhóm đang có bao nhiêu thành viên?",
  "Cho tôi tổng quan nhóm hiện tại.",
]);
add(
  "get_session_breakdown",
  [
    "Xem bảng chia của buổi Cầu lông tối thứ Năm.",
    "Buổi Cầu lông tối thứ Năm chia tiền ra sao?",
    "Ai chịu khoản nào trong buổi Cầu lông tối thứ Năm?",
  ],
  { session_id: sid },
);
add(
  "get_poll_results",
  [
    "Kết quả thăm dò Cuối tuần thế nào?",
    "Khung nào đông người nhất trong thăm dò Cuối tuần?",
    "Xem số phiếu thăm dò Cuối tuần.",
  ],
  { poll_id: pid },
);
add(
  "draft_rsvp",
  [
    "Tôi đi buổi Cầu lông tối thứ Năm.",
    "Chốt tôi tham gia buổi Cầu lông tối thứ Năm.",
  ],
  { session_id: sid, going: true },
);
add(
  "draft_rsvp",
  [
    "Tôi không đi buổi Cầu lông tối thứ Năm.",
    "Chốt không tham gia buổi Cầu lông tối thứ Năm.",
  ],
  { session_id: sid, going: false },
);
add("draft_vote", ["Tôi chọn Có cho khung 19 giờ của thăm dò Cuối tuần."], {
  option_id: option,
  answer: "yes",
});
add("draft_vote", ["Tôi chọn Có thể cho khung 19 giờ của thăm dò Cuối tuần."], {
  option_id: option,
  answer: "maybe",
});
add("draft_vote", ["Tôi chọn Không cho khung 19 giờ của thăm dò Cuối tuần."], {
  option_id: option,
  answer: "no",
});
add(
  "draft_mark_paid",
  [
    "Tôi đã chuyển khoản 85k cho An rồi.",
    "Báo tôi đã trả 85 nghìn cho An.",
    "Đánh dấu tôi đã chuyển khoản đang nợ An.",
  ],
  { settlement_id: payment },
);
add(
  "request_confirm_received",
  [
    "Tạo yêu cầu xác nhận tôi đã nhận khoản 85k của Bình.",
    "Tôi đã kiểm sao kê, muốn xác nhận nhận 85 nghìn từ Bình.",
    "Mở yêu cầu xác nhận khoản Bình chuyển 85k cho tôi.",
  ],
  { settlement_id: payment },
);
add(
  "draft_reminder",
  [
    "Nhắc Bình trả khoản 85k đang nợ tôi.",
    "Tạo nhắc riêng khoản Bình chưa trả 85 nghìn.",
    "Nhắc thanh toán khoản duy nhất Bình đang nợ tôi.",
  ],
  { settlement_id: payment },
);
add(
  "draft_expense",
  [
    "Thêm phụ phí Nước 50k vào buổi Cầu lông tối thứ Năm: tôi ứng, chỉ tôi chịu, tổng tiền chia đều, lý do mua nước.",
    "Thêm phụ phí Nước 50 nghìn vào buổi Cầu lông tối thứ Năm: tôi ứng, chỉ tôi chịu, tổng tiền chia đều, lý do mua nước.",
    "Thêm phụ phí Nước 50000đ vào buổi Cầu lông tối thứ Năm: tôi ứng, chỉ tôi chịu, tổng tiền chia đều, lý do mua nước.",
  ],
  { session_id: sid, amount: "50000", mode: "total", split: "equal" },
);
it.skipIf(process.env.AI_PROVIDER_EVAL !== "1")(
  "passes 40 Vietnamese tool/parameter cases with the encrypted test-group provider",
  async () => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    expect(cases).toHaveLength(40);
    const selected = process.env.AI_EVAL_CASES
      ? new Set(
          process.env.AI_EVAL_CASES.split(",").map((v) =>
            z.coerce.number().int().min(1).max(cases.length).parse(v),
          ),
        )
      : null;
    const db = new pg.Client({
      connectionString: databaseUrlForProject(
        process.env.SUPABASE_DB_URL,
        process.env.NEXT_PUBLIC_SUPABASE_URL,
      ),
      ssl: {
        ca: readFileSync("supabase/certs/prod-ca-2021.crt", "utf8"),
        rejectUnauthorized: true,
      },
      connectionTimeoutMillis: 15000,
    });
    const results: {
      case: number;
      passed: boolean;
      tokens: number;
      error?: string;
      calls?: { tool: string; input: unknown }[];
      finishReason?: string;
    }[] = [];
    try {
      await db.connect();
      const { groupId } = JSON.parse(
        readFileSync(".tools/ai-test-group.json", "utf8"),
      );
      const settings = (
        await db.query(
          "select s.provider,s.base_url,s.model,c.envelope from public.group_ai_settings s join app_private.ai_credentials c on c.group_id=s.group_id where s.group_id=$1 and s.enabled and s.status='approved'",
          [groupId],
        )
      ).rows[0];
      if (
        settings?.provider !== "openai-compatible" ||
        settings.base_url !== "https://openrouter.ai/api/v1"
      )
        throw Error("Expected enabled OpenRouter test group");
      const model = createOpenAICompatible({
        name: "group-provider",
        baseURL: settings.base_url,
        transformRequestBody: freeFallbackBody,
        apiKey: decryptGroupKey(
          groupId,
          settings.envelope,
          process.env.AI_KEY_ENCRYPTION_SECRET || "",
        ),
      })(settings.model);
      // Reuse production schemas with synthetic results. No business RPC executes.
      const fake = {} as Awaited<ReturnType<typeof supabase>>;
      const definitions = {
        ...readTools(fake, groupId, "00000000-0000-4000-8000-000000000001"),
        ...draftTools(fake, groupId),
      };
      const tools = Object.fromEntries(
        Object.entries(definitions).map(([name, definition]) => [
          name,
          {
            ...definition,
            execute: async () =>
              name === "get_session_breakdown"
                ? {
                    id: sid,
                    group_id: groupId,
                    title: "Cầu lông tối thứ Năm",
                    revision: "3",
                    status: "played",
                    my_member_id: "55555555-5555-4555-8555-555555555555",
                    collector_member_id: "55555555-5555-4555-8555-555555555555",
                    attendees: [
                      {
                        member_id: "55555555-5555-4555-8555-555555555555",
                        name: "An",
                        rsvp: "going",
                        weight: "1",
                        removed_at: null,
                      },
                    ],
                    expenses: [],
                    settlements: [],
                    href: `/sessions/${sid}`,
                  }
                : name.startsWith("get_") || name === "list_sessions"
                  ? {
                      group: { id: groupId, name: "Nhóm kiểm thử" },
                      total: "0",
                      rows: [],
                      sessions: [
                        {
                          id: sid,
                          title: "Cầu lông tối thứ Năm",
                          revision: "3",
                        },
                      ],
                      href: "/sessions",
                    }
                  : {
                      status: "pending",
                      id: "66666666-6666-4666-8666-666666666666",
                      href: "/ai/drafts/66666666-6666-4666-8666-666666666666",
                    },
          },
        ]),
      );
      for (const [index, c] of cases.entries()) {
        if (selected && !selected.has(index + 1)) continue;
        if (index) await new Promise((resolve) => setTimeout(resolve, 3200));
        try {
          const context = `Actor: An, user_id 00000000-0000-4000-8000-000000000001, member_id 55555555-5555-4555-8555-555555555555, role admin. ${c.tool === "draft_rsvp" ? "Session status planned, starts_at 2026-11-26T12:00:00Z, commit_deadline 2026-11-26T10:00:00Z, own RSVP none." : "Session status played, revision 3, collector_member_id 55555555-5555-4555-8555-555555555555; actor is the collector and a going attendee with weight 1; no confirmed payments; no lock. Expense categories and templates empty."} Nhóm kiểm thử. Tôi là An, member_id 55555555-5555-4555-8555-555555555555. Buổi Cầu lông tối thứ Năm có id ${sid}, revision 3. Thăm dò Cuối tuần id ${pid}, khung 19 giờ option_id ${option}. Khoản thanh toán duy nhất id ${payment}, 85000đ: nếu tôi nói đã chuyển thì tôi là người chuyển; nếu xác nhận nhận hoặc nhắc Bình thì tôi là người nhận. Khi thêm phụ phí không có danh mục: category_id rỗng, expense_id rỗng, note rỗng, values [].`;
          const r = await generateText({
            model,
            system: systemPrompt("2026-11-22T09:00:00Z"),
            prompt: context + "\n" + c.text,
            ...toolPalette(tools, c.text),
            stopWhen: stepCountIs(3),
            maxOutputTokens: 2000,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(30000),
          });
          const calls = r.steps.flatMap((step) => step.toolCalls);
          const call = calls.find((t) => t.toolName === c.tool);
          const passed =
            !!call &&
            Object.entries(c.input).every(
              ([k, v]) => (call.input as Record<string, unknown>)[k] === v,
            );
          results.push({
            case: index + 1,
            passed,
            tokens: r.totalUsage.totalTokens || 0,
            calls: calls.map((t) => ({
              tool: t.toolName,
              input: t.input,
            })),
            finishReason: r.finishReason,
          });
        } catch (e) {
          results.push({
            case: index + 1,
            passed: false,
            tokens: 0,
            error:
              e && typeof e === "object" && "statusCode" in e
                ? String(e.statusCode)
                : "PROVIDER_ERROR",
          });
        }
        console.log(
          `AI eval ${index + 1}/40: ${results.at(-1)!.passed ? "PASS" : "FAIL"}`,
        );
        if (results.at(-1)?.error === "429") break;
      }
      mkdirSync(".tools", { recursive: true });
      const at = new Date().toISOString();
      writeFileSync(
        `.tools/ai-provider-eval-${at.replace(/[:.]/g, "-")}.json`,
        JSON.stringify(
          {
            promptVersion: PROMPT_VERSION,
            model: settings.model,
            at,
            results,
            diagnostic: !!selected,
            expectedCases: selected?.size || cases.length,
            complete: results.length === (selected?.size || cases.length),
          },
          null,
          2,
        ),
      );
      writeFileSync(
        process.env.AI_EVAL_CASES
          ? ".tools/ai-provider-eval-diagnostic.json"
          : ".tools/ai-provider-eval.json",
        JSON.stringify(
          {
            promptVersion: PROMPT_VERSION,
            model: settings.model,
            at: new Date().toISOString(),
            results,
            diagnostic: !!selected,
            expectedCases: selected?.size || cases.length,
            complete: results.length === (selected?.size || cases.length),
          },
          null,
          2,
        ),
      );
      expect(results).toHaveLength(selected?.size || cases.length);
      expect(results.filter((r) => !r.passed).map((r) => r.case)).toEqual([]);
    } finally {
      await db.end().catch(() => {});
    }
  },
  900000,
);
