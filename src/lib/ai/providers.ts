import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { freeFallbackBody } from "./free-fallback.mjs";
export function groupModel(
  settings: { provider: string; model: string; base_url: string | null },
  apiKey: string,
) {
  if (settings.provider === "google")
    return createGoogleGenerativeAI({ apiKey })(settings.model);
  if (settings.provider === "anthropic")
    return createAnthropic({ apiKey })(settings.model);
  if (settings.provider === "openai-compatible" && settings.base_url) {
    const url = new URL(settings.base_url),
      allowed = (
        process.env.AI_ALLOWED_COMPATIBLE_HOSTS ||
        "api.openai.com,openrouter.ai"
      ).split(",");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !allowed.includes(url.hostname)
    )
      throw Error("Provider host not allowed");
    return createOpenAICompatible({
      name: "group-provider",
      apiKey,
      baseURL: url.href,
      ...(url.href === "https://openrouter.ai/api/v1" ||
      url.href === "https://openrouter.ai/api/v1/"
        ? { transformRequestBody: freeFallbackBody }
        : {}),
    })(settings.model);
  }
  throw Error("Unsupported provider");
}
