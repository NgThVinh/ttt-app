export function generationLimits(provider: string, model: string) {
  if (provider === "google" && model === "gemini-3.5-flash-lite")
    return {
      maxOutputTokens: 512,
      providerOptions: {
        google: { thinkingConfig: { thinkingLevel: "minimal" as const } },
      },
    };
  return { maxOutputTokens: 1000 };
}
