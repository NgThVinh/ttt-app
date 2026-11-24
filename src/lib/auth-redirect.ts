/** Accept only return destinations created by our invitation flow. */
export function safeReturnPath(value: unknown): string {
  return typeof value === "string" &&
    /^\/join\/[a-f0-9]{64}(\?session=[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})?$/.test(
      value,
    )
    ? value
    : "/";
}
