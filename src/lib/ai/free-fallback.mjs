/** OpenRouter performs failover before returning output. Never replay a chat
 * step locally: it may already have executed a business tool. */
export function freeFallbackBody(body) {
  if (
    typeof body.model !== "string" ||
    !(body.model.endsWith(":free") || body.model === "openrouter/free")
  )
    return body;
  return {
    ...body,
    models: [...new Set([body.model, "openrouter/free"])],
    provider: {
      ...body.provider,
      allow_fallbacks: true,
      require_parameters: true,
      max_price: { prompt: 0, completion: 0, request: 0 },
    },
  };
}
