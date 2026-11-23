export function profileName(
  saved: unknown,
  metadata: Record<string, unknown>,
): string {
  for (const value of [saved, metadata.full_name, metadata.name]) {
    if (typeof value === "string" && value.trim())
      return value.trim().slice(0, 100);
  }
  return "";
}
