export interface NotificationChannel {
  deliver(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: { tag: string; href: string },
  ): Promise<"sent" | "expired" | "retry">;
}
export function safeAppPath(value: string) {
  return /^\/(sessions|polls|groups)\/[0-9a-f-]{36}$/.test(value) ||
    ["/approvals", "/notifications"].includes(value)
    ? value
    : "/notifications";
}
