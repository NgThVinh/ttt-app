export interface NotificationChannel {
  deliver(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: { tag: string; href: string },
  ): Promise<"sent" | "expired" | "retry">;
}
export function safeAppPath(value: string) {
  if (/^\/polls\/[0-9a-f-]{36}$/.test(value)) return "/sessions";
  return /^\/(sessions|groups)\/[0-9a-f-]{36}$/.test(value) ||
    [
      "/",
      "/sessions",
      "/groups",
      "/approvals",
      "/notifications",
      "/me",
      "/ai/settings",
    ].includes(value)
    ? value
    : "/notifications";
}
