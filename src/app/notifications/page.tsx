import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import LiveUpdates from "@/components/live-updates";
import ActionForm from "@/components/action-form";
import { readNotification } from "./read-actions";
import { safeAppPath } from "@/lib/notifications";
export default async function Notifications() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await db
    .from("notifications")
    .select("id,title,href,created_at,read_at")
    .order("created_at", { ascending: false })
    .limit(100);
  return (
    <main>
      <Link href="/">Trang chủ</Link>
      <h1>Thông báo của tôi</h1>
      <LiveUpdates tables={["notifications"]} />
      {error && <p role="alert">Chưa tải được thông báo.</p>}
      {!data?.length && !error && <p>Bạn chưa có thông báo.</p>}
      {data?.map((n) => (
        <section className="panel" key={n.id}>
          <Link href={safeAppPath(n.href)}>
            <h2>{n.title}</h2>
          </Link>
          <p>
            {new Date(n.created_at).toLocaleString("vi-VN", {
              timeZone: "Asia/Ho_Chi_Minh",
            })}{" "}
            · {n.read_at ? "Đã đọc" : "Chưa đọc"}
          </p>
          {!n.read_at && (
            <ActionForm action={readNotification} label="Đánh dấu đã đọc">
              <input type="hidden" name="id" value={n.id} />
            </ActionForm>
          )}
        </section>
      ))}
    </main>
  );
}
export const metadata = { title: "Thông báo" };
