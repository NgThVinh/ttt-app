/** Accept only return destinations created by our invitation flow. */
export function safeReturnPath(value: unknown): string {
  return typeof value === "string" && /^\/join\/[a-f0-9]{64}$/.test(value)
    ? value
    : "/";
}
