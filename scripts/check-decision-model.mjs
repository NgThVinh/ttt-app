import pg from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { databaseUrlForProject } from "./migration-utils.mjs";
import { decryptGroupKey } from "../src/lib/ai/crypto.ts";
import { decisionEvalCases } from "../src/lib/ai/harness/decision-eval-cases.mjs";
import {
  isFreeDecisionModel,
  probeDecision,
  decisionBatchRequest,
  parseDecisionBatch,
} from "../src/lib/ai/harness/decision-router.mjs";
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
const db = new pg.Client({
  connectionString: databaseUrlForProject(
    process.env.SUPABASE_DB_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  ssl: {
    ca: readFileSync(
      new URL("../supabase/certs/prod-ca-2021.crt", import.meta.url),
      "utf8",
    ),
    rejectUnauthorized: true,
  },
  connectionTimeoutMillis: 15000,
  query_timeout: 15000,
});
try {
  const { groupId } = JSON.parse(
    readFileSync(".tools/ai-test-group.json", "utf8"),
  );
  const catalog = await fetch(
    "https://openrouter.ai/api/v1/models?output_modalities=all",
    { signal: AbortSignal.timeout(15000) },
  );
  if (!catalog.ok)
    throw Object.assign(new Error(), {
      code: "MODEL_CATALOG_" + catalog.status,
    });
  const { data: models } = await catalog.json();
  const candidates = models.filter(isFreeDecisionModel);
  const model =
    candidates.find(
      (m) => m.id === "perplexity/pplx-decider-flash-v1.3:free",
    ) || candidates.find((m) => m.id === "perplexity/pplx-decider-v1.3:free");
  if (!model)
    throw Object.assign(new Error(), {
      code: "NO_VERIFIED_FREE_DECISION_MODEL",
    });
  await db.connect();
  const settings = (
    await db.query(
      "select s.provider,s.base_url,c.envelope from public.group_ai_settings s join app_private.ai_credentials c on c.group_id=s.group_id where s.group_id=$1 and s.enabled and s.status='approved'",
      [groupId],
    )
  ).rows[0];
  if (
    settings?.provider !== "openai-compatible" ||
    settings.base_url !== "https://openrouter.ai/api/v1"
  )
    throw Object.assign(new Error(), {
      code: "OPENROUTER_TEST_GROUP_REQUIRED",
    });
  const key = decryptGroupKey(
    groupId,
    settings.envelope,
    process.env.AI_KEY_ENCRYPTION_SECRET,
  );
  if (process.argv.includes("--batch")) {
    const smokeCases = [
      { id: "debt", message: "Ai còn nợ tiền tôi?", expected: "debts" },
      {
        id: "sent",
        message: "Tôi đã chuyển An 85k rồi.",
        expected: "mark_paid",
      },
      {
        id: "received",
        message: "Tôi muốn xác nhận đã nhận khoản Bình chuyển.",
        expected: "confirm_received",
      },
      {
        id: "water",
        message: "Thêm phụ phí nước 50 nghìn chia cho mọi người.",
        expected: "expense",
      },
      {
        id: "schedule",
        message: "Tạo lịch cầu lông tối thứ Năm tuần sau.",
        expected: "schedule",
      },
      {
        id: "poll",
        message: "Tạo thăm dò chọn thứ Năm hoặc thứ Bảy.",
        expected: "poll",
      },
      {
        id: "rsvp",
        message: "Chốt tôi không đi buổi thứ Năm.",
        expected: "rsvp",
      },
      {
        id: "admin",
        message: "Xóa Bình khỏi nhóm và đổi số tài khoản ngân hàng.",
        expected: "privileged",
      },
    ];
    const cases = process.argv.includes("--full")
      ? decisionEvalCases
      : smokeCases;
    const start = Date.now();
    const results = [];
    const usages = [];
    for (let offset = 0; offset < cases.length; offset += 10) {
      const batch = cases.slice(offset, offset + 10);
      const response = await fetch(
        "https://openrouter.ai/api/alpha/decisions",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            decisionBatchRequest(
              model.id,
              batch.map(({ id, message }) => ({ id, message })),
            ),
          ),
          signal: AbortSignal.timeout(30000),
          redirect: "error",
        },
      );
      if (!response.ok) {
        console.log(
          JSON.stringify({
            ok: false,
            status: response.status,
            model: model.id,
          }),
        );
        process.exitCode = 1;
      } else {
        const value = await response.json(),
          answers = parseDecisionBatch(
            value,
            batch.map((c) => c.id),
          );
        results.push(
          ...batch.map((c) => ({
            id: c.id,
            expected: c.expected,
            ...answers[c.id],
            passed: answers[c.id].intent === c.expected,
          })),
        );
        usages.push(value.usage || null);
      }
      if (!response.ok) break;
    }
    const report = {
      at: new Date().toISOString(),
      model: model.id,
      latencyMs: Date.now() - start,
      passed: results.filter((r) => r.passed).length,
      total: cases.length,
      completed: results.length,
      usages,
      results,
    };
    writeFileSync(
      process.argv.includes("--full")
        ? ".tools/ai-decision-full.json"
        : ".tools/ai-decision-batch.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    if (report.passed !== report.total || report.completed !== report.total)
      process.exitCode = 1;
  } else {
    // One small synthetic classification probe, even if chat quota is exhausted:
    // the actual Decisions response determines whether this endpoint is available.
    const result = await probeDecision(
      key,
      model.id,
      "Tôi đã chuyển An 85k rồi.",
    );
    const report = {
      at: new Date().toISOString(),
      endpoint: "/api/alpha/decisions",
      model: model.id,
      verifiedFreeModels: candidates.map((m) => m.id),
      expectedIntent: "mark_paid",
      ...result,
    };
    writeFileSync(
      ".tools/ai-decision-probe.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    if (!result.ok || result.intent !== "mark_paid") process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({ code: error.code || error.name }));
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
