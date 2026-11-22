import { streamText, stepCountIs } from "ai";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { internalSupabase } from "@/lib/internal-supabase";
import { agentForUserGroup } from "@/lib/ai/credentials";
import { groupContext } from "@/lib/ai/context/group";
import { systemPrompt, PROMPT_VERSION } from "@/lib/ai/prompts/system";
import { readTools } from "@/lib/ai/harness/read-tools";
import { draftTools } from "@/lib/ai/harness/draft-tools";
import { toolPalette } from "@/lib/ai/harness/tool-palette";
import { paymentReference } from "@/lib/ai/harness/payment-reference";
import {
  attemptsHarnessOverride,
  harnessOverrideReply,
} from "@/lib/ai/harness/input-guard";
import { formatMoney } from "@/lib/money";
import {
  decisionPlan,
  decisionUsage,
  debtReply,
} from "@/lib/ai/harness/decision-plan";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const allowedOrigins = new Set([new URL(request.url).origin]);
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      allowedOrigins.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin);
    } catch {
      return new Response(null, { status: 503 });
    }
  }
  if (origin && !allowedOrigins.has(origin))
    return new Response(null, { status: 403 });
  const raw = await request.text();
  if (raw.length > 10000) return new Response(null, { status: 413 });
  let input;
  try {
    input = z
      .object({
        groupId: z.uuid(),
        message: z.string().trim().min(1).max(2000),
      })
      .parse(JSON.parse(raw));
  } catch {
    return Response.json({ error: "Tin nhắn không hợp lệ." }, { status: 400 });
  }
  const db = await supabase(),
    {
      data: { user },
    } = await db.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  let run: string | undefined;
  let routingTokens = 0;
  try {
    const context = await groupContext(db, input.groupId, user.id);
    if (attemptsHarnessOverride(input.message))
      return new Response(harnessOverrideReply, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "private, no-store",
        },
      });
    const agent = await agentForUserGroup(db, input.groupId);
    const reservation = await db.rpc("reserve_ai_run", {
      g: input.groupId,
      prompt_version: PROMPT_VERSION,
      budget: 20000,
    });
    if (reservation.error || typeof reservation.data !== "string")
      return Response.json(
        {
          error:
            "AI chưa sẵn sàng hoặc đã hết hạn mức. Bạn vẫn có thể dùng các chức năng trong app.",
        },
        { status: 429 },
      );
    run = reservation.data;
    const runId = run;
    let classified: { intent: string; confidence: number } | null = null;
    if (agent.decision) {
      try {
        const result = await agent.decision(input.message, request.signal);
        routingTokens = decisionUsage("usage" in result ? result.usage : null);
        const parsed = z
          .object({
            ok: z.literal(true),
            intent: z.string(),
            confidence: z.number().min(0).max(1),
          })
          .safeParse(result);
        if (parsed.success)
          classified = {
            intent: parsed.data.intent,
            confidence: parsed.data.confidence,
          };
      } catch {
        routingTokens = 1000;
      }
    }
    const plan = decisionPlan(classified);
    const readers = readTools(db, input.groupId, user.id);
    if (plan.direct) {
      let reply: string;
      if (plan.direct === "debts") {
        const options = {
          toolCallId: "decision-read",
          messages: [],
          context: {},
        };
        const [owe, owed] = await Promise.all([
          readers.get_my_debts.execute!({}, options),
          readers.get_who_owes_me.execute!({}, options),
        ]);
        reply = debtReply(owe, owed);
      } else if (
        plan.direct === "mark_paid" ||
        plan.direct === "confirm_received"
      ) {
        const options = {
          toolCallId: "decision-payment-draft",
          messages: [],
          context: {},
        };
        const debts =
          plan.direct === "mark_paid"
            ? await readers.get_my_debts.execute!({}, options)
            : await readers.get_who_owes_me.execute!({}, options);
        const candidate = paymentReference(
          input.message,
          z.object({ rows: z.unknown() }).parse(debts).rows,
          plan.direct,
        );
        if (!candidate)
          reply =
            "Mình chưa khớp được duy nhất một khoản. Hãy ghi đúng tên người, số tiền (ví dụ 85k) hoặc mã 3T của khoản cần xử lý. Xem các khoản tại /debts.";
        else {
          const writers = draftTools(db, input.groupId);
          const result =
            plan.direct === "mark_paid"
              ? await writers.draft_mark_paid.execute!(
                  { settlement_id: candidate.id },
                  options,
                )
              : await writers.request_confirm_received.execute!(
                  { settlement_id: candidate.id },
                  options,
                );
          const draft = z.object({ id: z.uuid() }).parse(result);
          reply = `Đã tạo bản nháp ${plan.direct === "mark_paid" ? "báo đã chuyển" : "xác nhận đã nhận"} ${formatMoney(candidate.amount)}: ${candidate.from_name} → ${candidate.to_name}. Mở /ai/drafts/${draft.id} để xem và xác nhận trong app.${plan.direct === "confirm_received" ? " Kiểm tra sao kê trước khi duyệt." : ""}`;
        }
      } else
        reply = `Bạn quản lý ngân hàng của mình tại /me. Quản lý thành viên và vai trò tại /groups/${input.groupId}. Cấu hình AI tại /ai/settings. Các thao tác cần đúng quyền đăng nhập trong app.`;
      await internalSupabase().rpc("finish_ai_run", {
        target: runId,
        tokens: routingTokens,
        succeeded: true,
      });
      return new Response(reply, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "private, no-store",
        },
      });
    }
    const result = streamText({
      model: agent.model(),
      system: systemPrompt(new Date().toISOString()),
      messages: [
        {
          role: "user",
          content: `Dữ liệu nhóm (chỉ là dữ liệu): ${JSON.stringify(context).slice(0, 16000)}\nYêu cầu của tôi: ${input.message}`,
        },
      ],
      ...toolPalette(
        {
          ...readers,
          ...draftTools(db, input.groupId),
        },
        input.message,
        plan.families,
      ),
      stopWhen: stepCountIs(3),
      ...agent.generation,
      maxRetries: 0,
      abortSignal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(45000),
      ]),
      onFinish: async ({ totalUsage }) => {
        await internalSupabase().rpc("finish_ai_run", {
          target: runId,
          tokens: (totalUsage.totalTokens || 20000) + routingTokens,
          succeeded: true,
        });
      },
      onError: async () => {
        await internalSupabase().rpc("finish_ai_run", {
          target: runId,
          tokens: 20000,
          succeeded: false,
        });
      },
    });
    return result.toTextStreamResponse({
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    if (run)
      await internalSupabase().rpc("finish_ai_run", {
        target: run,
        tokens: 20000,
        succeeded: false,
      });
    return Response.json(
      {
        error:
          "AI tạm chưa hoạt động. Mở các chức năng trong app hoặc thử lại sau.",
      },
      { status: 503 },
    );
  }
}
