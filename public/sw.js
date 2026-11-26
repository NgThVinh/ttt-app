/* Only these public fallback assets are cached. Never cache an authenticated
 * navigation, API response, RSC payload or payment request. */
const CACHE = "3t-public-v2";
const PUBLIC_ASSETS = ["/offline.html", "/icon-192.png"];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PUBLIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("3t-public-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        async () => (await caches.match("/offline.html")) || Response.error(),
      ),
    );
  } else if (PUBLIC_ASSETS.includes(url.pathname) && !url.search) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request)),
    );
  }
});
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
