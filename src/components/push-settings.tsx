"use client";
import { useState } from "react";
import { subscribePush, unsubscribePush } from "@/app/notifications/actions";
export default function PushSettings() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function change(enable: boolean) {
    setBusy(true);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        throw Error(
          "Trình duyệt chưa hỗ trợ push. Trên iPhone/iPad, thêm app vào Màn hình chính rồi mở từ biểu tượng.",
        );
      if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
        throw Error(
          "Push chưa được cấu hình. Thông báo trong app vẫn hoạt động.",
        );
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (enable) {
        if ((await Notification.requestPermission()) !== "granted")
          throw Error(
            "Bạn chưa cho phép thông báo. Có thể thay đổi trong cài đặt trình duyệt.",
          );
        const raw = atob(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY.replace(/-/g, "+").replace(
            /_/g,
            "/",
          ),
        );
        const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        subscription ??= await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        const result = await subscribePush(subscription.toJSON());
        if (result.error) throw Error(result.error);
        setMessage("Đã bật thông báo trên thiết bị này.");
      } else {
        if (subscription) {
          const result = await unsubscribePush(subscription.endpoint);
          if (result.error) throw Error(result.error);
          await subscription.unsubscribe();
        }
        setMessage("Đã tắt thông báo trên thiết bị này.");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Chưa cập nhật được push.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Thông báo trên thiết bị</h2>
      <p>
        Chỉ bật khi bạn muốn nhận nhắc lịch và thanh toán. Trên iPhone/iPad cần
        cài app vào Màn hình chính.
      </p>
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => change(true)}
        >
          Bật thông báo
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => change(false)}
        >
          Tắt trên thiết bị này
        </button>
      </div>
      <p role="status">{message}</p>
    </section>
  );
}
