import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { supabase } from "@/lib/supabase";
import JoinGroupForm from "@/components/join-group-form";
import { logout } from "@/app/actions";
import { z } from "zod";
const invitationSchema = z.object({
  group_id: z.uuid(),
  group_name: z.string(),
  guests: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export default async function Join({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { token } = await params;
  const candidate = z.uuid().safeParse((await searchParams).session);
  const sessionId = candidate.success ? candidate.data : "";
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const next = `/join/${token}${sessionId ? `?session=${sessionId}` : ""}`;
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login?next=" + encodeURIComponent(next));
  const { data, error } = await db.rpc("invite_details", {
    hashed_token: createHash("sha256").update(token).digest("hex"),
  });
  const invitation = invitationSchema.safeParse(data);
  return (
    <main className="auth-page">
      <Link className="auth-brand" href="/" aria-label="3T · Thích Tính Tiền">
        <span>3T</span> Thích Tính Tiền
      </Link>
      <section className="login-card auth-card">
        {error || !invitation.success ? (
          <>
            <h1>Không mở được lời mời</h1>
            <p>
              Link có thể đã hết hạn, hết lượt hoặc bị thu hồi. Nhờ một thành
              viên gửi lại link mời; nếu bạn đã bị gỡ, hãy liên hệ admin.
            </p>
            <Link href="/">Về trang chủ</Link>
          </>
        ) : (
          <>
            <h1>Tham gia {invitation.data.group_name}</h1>
            <p>
              Đang dùng email <strong>{user.email}</strong>
            </p>
            <JoinGroupForm
              token={token}
              sessionId={sessionId}
              name={
                typeof user.user_metadata.full_name === "string"
                  ? user.user_metadata.full_name
                  : user.email?.split("@")[0] || ""
              }
              guests={invitation.data.guests}
            />
          </>
        )}
        <form action={logout}>
          <input type="hidden" name="next" value={next} />
          <button className="auth-account-switch secondary" type="submit">
            Dùng tài khoản khác
          </button>
        </form>
      </section>
    </main>
  );
}
export const metadata = { title: "Lời mời vào nhóm" };
