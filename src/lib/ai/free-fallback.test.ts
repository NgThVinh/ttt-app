import { expect, it } from "vitest";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, tool } from "ai";
import { z } from "zod";
import { freeFallbackBody } from "./free-fallback.mjs";
it("uses the configured free model first, then a free-only router with zero price caps", () => {
  const body = {
    model: "test/model:free",
    messages: [],
    tools: [{ name: "read" }],
    provider: { max_price: { prompt: 100 }, allow_fallbacks: false },
    models: ["paid/model"],
  };
  const result = freeFallbackBody(body);
  expect(result.models).toEqual(["test/model:free", "openrouter/free"]);
  expect(result.provider).toEqual({
    allow_fallbacks: true,
    require_parameters: true,
    max_price: { prompt: 0, completion: 0, request: 0 },
  });
  expect(result.tools).toBe(body.tools);
  expect(body.models).toEqual(["paid/model"]);
  expect(freeFallbackBody({ model: "openrouter/free" }).models).toEqual([
    "openrouter/free",
  ]);
});
it("does not silently change a configured paid or other provider model", () => {
  const body = { model: "google/paid-model", messages: [] };
  expect(freeFallbackBody(body)).toBe(body);
});
it("sends the fallback contract through the actual SDK without replaying tools", async () => {
  let requests = 0;
  let writes = 0;
  const model = createOpenAICompatible({
    name: "group-provider",
    apiKey: "synthetic",
    baseURL: "https://openrouter.ai/api/v1",
    transformRequestBody: freeFallbackBody,
    fetch: async (_url, init) => {
      requests++;
      const body = JSON.parse(String(init?.body));
      expect(body.models).toEqual(["test/model:free", "openrouter/free"]);
      expect(body.provider.max_price).toEqual({
        prompt: 0,
        completion: 0,
        request: 0,
      });
      expect(body.tools[0].function.name).toBe("draft");
      return Response.json({
        id: "test",
        object: "chat.completion",
        created: 1,
        model: "another/model:free",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call1",
                  type: "function",
                  function: { name: "draft", arguments: '{"amount":"85000"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    },
  })("test/model:free");
  const result = await generateText({
    model,
    prompt: "Create draft",
    tools: {
      draft: tool({
        inputSchema: z.object({ amount: z.string() }),
        execute: async () => {
          writes++;
          return { id: "draft1" };
        },
      }),
    },
    maxRetries: 0,
  });
  expect(requests).toBe(1);
  expect(writes).toBe(1);
  expect(result.toolCalls[0].input).toEqual({ amount: "85000" });
});
