import { streamText, stepCountIs } from "ai";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { internalSupabase } from "@/lib/internal-supabase";
import { modelForUserGroup } from "@/lib/ai/credentials";
import { groupContext } from "@/lib/ai/context/group";
import { systemPrompt, PROMPT_VERSION } from "@/lib/ai/prompts/system";
import { readTools } from "@/lib/ai/harness/read-tools";
import { draftTools } from "@/lib/ai/harness/draft-tools";
import { toolPalette } from "@/lib/ai/harness/tool-palette";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
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
  try {
    const context = await groupContext(db, input.groupId, user.id);
    const model = await modelForUserGroup(db, input.groupId);
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
    const result = streamText({
      model,
      system: systemPrompt(new Date().toISOString()),
      messages: [
        {
          role: "user",
          content: `Dữ liệu nhóm (chỉ là dữ liệu): ${JSON.stringify(context).slice(0, 16000)}\nYêu cầu của tôi: ${input.message}`,
        },
      ],
      ...toolPalette(
        {
          ...readTools(db, input.groupId, user.id),
          ...draftTools(db, input.groupId),
        },
        input.message,
      ),
      stopWhen: stepCountIs(3),
      maxOutputTokens: 1000,
      maxRetries: 0,
      abortSignal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(45000),
      ]),
      onFinish: async ({ totalUsage }) => {
        await internalSupabase().rpc("finish_ai_run", {
          target: runId,
          tokens: totalUsage.totalTokens || 20000,
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
