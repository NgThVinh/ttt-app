/* No authenticated pages, API responses, or payment data are cached. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {}
  const href =
    (typeof payload.href === "string" &&
      /^\/(sessions|polls|groups)\/[0-9a-f-]{36}$/.test(payload.href)) ||
    ["/approvals", "/notifications"].includes(payload.href)
      ? payload.href
      : "/notifications";
  event.waitUntil(
    self.registration.showNotification("3T · Có cập nhật mới", {
      body: "Mở app để xem lịch và việc cần làm.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.tag || "3t",
      data: { href },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    event.notification.data?.href || "/notifications",
    self.location.origin,
  );
  if (url.origin !== self.location.origin) return;
  event.waitUntil(self.clients.openWindow(url.href));
});
