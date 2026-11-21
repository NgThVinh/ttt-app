import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import ActionForm from "@/components/action-form";
import ShareButton from "@/components/share-button";
import LiveUpdates from "@/components/live-updates";
import { votePoll, closePoll } from "../actions";
export default async function Poll({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: p } = await db
    .from("polls")
    .select(
      "id,group_id,title,venue,status,closes_at,min_attendees,created_by,resulting_session_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!p) notFound();
  const [{ data: options }, { data: members }] = await Promise.all([
    db
      .from("poll_options")
      .select("id,starts_at,ends_at")
      .eq("poll_id", id)
      .order("starts_at"),
    db
      .from("group_members")
      .select("id,user_id,display_name,role")
      .eq("group_id", p.group_id)
      .eq("status", "active"),
  ]);
  const { data: votes } = options?.length
    ? await db
        .from("poll_votes")
        .select("option_id,member_id,answer")
        .in(
          "option_id",
          options.map((o) => o.id),
        )
    : { data: [] };
  const active = new Set(members?.map((m) => m.id));
  const count = (option: string, answer: string) =>
    votes?.filter(
      (v) =>
        v.option_id === option &&
        v.answer === answer &&
        active.has(v.member_id),
    ).length || 0;
  const ranked = [...(options || [])].sort(
    (a, b) =>
      count(b.id, "yes") - count(a.id, "yes") ||
      count(b.id, "maybe") - count(a.id, "maybe") ||
      a.starts_at.localeCompare(b.starts_at),
  );
  const mine = members?.find((m) => m.user_id === user.id);
  const canClose = p.created_by === user.id || mine?.role === "admin";
  const date = (s: string) =>
    new Date(s).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  return (
    <main>
      <Link href="/polls">Các thăm dò</Link>
      <h1>{p.title}</h1>
      <p>
        {p.venue} · Hạn trả lời {date(p.closes_at)} · Tối thiểu{" "}
        {p.min_attendees} người đồng ý
      </p>
      <LiveUpdates tables={["polls", "poll_votes"]} />
      <ShareButton
        title={p.title}
        text={`Cùng chọn lịch ${p.title} tại ${p.venue}. Hạn trả lời ${date(p.closes_at)}.`}
        path={`/polls/${p.id}`}
      />
      {p.resulting_session_id && (
        <p>
          <Link
            className="primary"
            href={`/sessions/${p.resulting_session_id}`}
          >
            Xem buổi đã chốt — nhớ tự chốt tham gia
          </Link>
        </p>
      )}
      {ranked.map((o, i) => (
        <section className="panel" key={o.id}>
          <h2>
            {date(o.starts_at)} đến {date(o.ends_at)}
          </h2>
          <p>
            {i === 0 ? "Khung có nhiều người đồng ý nhất · " : ""}
            {count(o.id, "yes")} đi được · {count(o.id, "maybe")} có thể ·{" "}
            {count(o.id, "no")} không đi
          </p>
          <p>
            {members
              ?.filter((m) =>
                votes?.some(
                  (v) =>
                    v.option_id === o.id &&
                    v.member_id === m.id &&
                    v.answer === "yes",
                ),
              )
              .map((m) => m.display_name)
              .join(", ") || "Chưa ai chọn đi được"}
          </p>
          <p>
            Chưa trả lời:{" "}
            {members
              ?.filter(
                (m) =>
                  !votes?.some(
                    (v) => v.option_id === o.id && v.member_id === m.id,
                  ),
              )
              .map((m) => m.display_name)
              .join(", ") || "Cả nhóm đã trả lời"}
          </p>
          {p.status === "open" && (
            <ActionForm action={votePoll} label="Lưu lựa chọn">
              <input type="hidden" name="id" value={o.id} />
              <select
                aria-label="Khả năng tham gia"
                name="answer"
                defaultValue={
                  votes?.find(
                    (v) => v.option_id === o.id && v.member_id === mine?.id,
                  )?.answer || "maybe"
                }
              >
                <option value="yes">Tôi đi được</option>
                <option value="maybe">Có thể</option>
                <option value="no">Tôi không đi được</option>
              </select>
            </ActionForm>
          )}
          {canClose && p.status === "open" && (
            <ActionForm
              action={closePoll}
              label="Chốt khung giờ này và tạo buổi"
            >
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="option" value={o.id} />
              <p>
                Phiếu đồng ý chỉ điền sẵn ý định. Mỗi người vẫn tự chốt đi trong
                buổi mới.
              </p>
            </ActionForm>
          )}
        </section>
      ))}
    </main>
  );
}
