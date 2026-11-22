import pg from "pg";
import { readFileSync } from "node:fs";
import { databaseUrlForProject } from "./migration-utils.mjs";
import { decryptGroupKey } from "../src/lib/ai/crypto.ts";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
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
});
try {
  const { groupId } = JSON.parse(
    readFileSync(".tools/ai-test-group.json", "utf8"),
  );
  await db.connect();
  const settings = (
    await db.query(
      "select s.model,c.envelope from public.group_ai_settings s join app_private.ai_credentials c on c.group_id=s.group_id where s.group_id=$1 and s.status='approved' and s.enabled",
      [groupId],
    )
  ).rows[0];
  if (!settings)
    throw Object.assign(new Error(), { code: "TEST_GROUP_NOT_ENABLED" });
  if (process.argv[2]) {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(process.argv[2]),
      {
        headers: {
          "x-goog-api-key": decryptGroupKey(
            groupId,
            settings.envelope,
            process.env.AI_KEY_ENCRYPTION_SECRET,
          ),
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok)
      throw Object.assign(new Error(), {
        code: "MODEL_UNAVAILABLE_" + r.status,
      });
    settings.model = process.argv[2];
  }
  const apiKey = decryptGroupKey(
    groupId,
    settings.envelope,
    process.env.AI_KEY_ENCRYPTION_SECRET,
  );
  const result = await generateText({
    model: createGoogleGenerativeAI({ apiKey })(settings.model),
    prompt: "Trả lời đúng một từ: sẵn-sàng",
    maxOutputTokens: 256,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(90000),
  });
  console.log(
    JSON.stringify({
      connected: !!result.text,
      model: settings.model,
      groupCredential: true,
      tokens: result.totalUsage.totalTokens,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      connected: false,
      code: error.statusCode || error.code || error.name,
      kind: error.name,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
