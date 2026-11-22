"use client";
import { useEffect, useSyncExternalStore } from "react";
function subscribe(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}
export default function PWARuntime() {
  const offline = useSyncExternalStore(
    subscribe,
    () => !navigator.onLine,
    () => false,
  );
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext)
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {
          // In-app features remain available when worker registration fails.
        });
  }, []);
  return offline ? (
    <div className="connection-banner" role="status">
      Bạn đang ngoại tuyến. Kết nối lại rồi kiểm tra trạng thái trước khi gửi
      lại thao tác.
    </div>
  ) : null;
}
