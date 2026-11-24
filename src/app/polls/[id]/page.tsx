import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import ActionForm from "@/components/action-form";
import ShareButton from "@/components/share-button";
import LiveUpdates from "@/components/live-updates";
import PollVoteButtons from "@/components/poll-vote-buttons";
import { finishPoll } from "../actions";
import { pollStatus } from "@/lib/poll-draft";
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
      "id,group_id,title,venue,status,closes_at,created_by,resulting_session_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!p) notFound();
  const [
    { data: options, error: optionsError },
    { data: members, error: membersError },
  ] = await Promise.all([
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
  const { data: votes, error: votesError } = options?.length
    ? await db
        .from("poll_votes")
        .select("option_id,member_id,answer")
        .in(
          "option_id",
          options.map((o) => o.id),
        )
    : { data: [], error: null };
  const active = new Set(members?.map((m) => m.id)),
    mine = members?.find((m) => m.user_id === user.id),
    now = new Date().getTime(),
    open = p.status === "open" && Date.parse(p.closes_at) > now;
  const count = (oid: string, answer: string) =>
    votes?.filter(
      (v) =>
        v.option_id === oid && v.answer === answer && active.has(v.member_id),
    ).length || 0;
  const max = Math.max(0, ...(options || []).map((o) => count(o.id, "yes")));
  const date = (v: string) =>
    new Date(v).toLocaleString("vi-VN", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh",
    });
  const loadError = optionsError || membersError || votesError;
  return (
    <main className="poll-workspace">
      <Link href="/polls">Các thăm dò</Link>
      <div className="page-heading">
        <div>
          <h1>{p.title}</h1>
          <p>
            {p.venue !== "Chưa chọn sân" ? p.venue + " · " : ""}
            {pollStatus(p.status, p.closes_at, !!p.resulting_session_id, now)}
          </p>
        </div>
        <ShareButton
          title={p.title}
          text={`Cùng chọn lúc rảnh: ${p.title}.`}
          path={`/polls/${p.id}`}
        />
      </div>
      <LiveUpdates tables={["polls", "poll_votes"]} />
      <div className="poll-help">
        <span>
          {open
            ? `Trả lời trước ${date(p.closes_at)}`
            : "Thăm dò đã ngừng nhận phiếu."}
        </span>
        <span>Vote để thăm dò; bạn sẽ nhận lời tham gia sau khi có buổi.</span>
      </div>
      {loadError && (
        <p role="alert">
          Chưa tải đủ kết quả. Hãy tải lại trước khi chọn lịch.
        </p>
      )}
      {p.resulting_session_id && (
        <div className="poll-session-link">
          <strong>Đã tạo buổi từ thăm dò này</strong>
          <Link
            className="primary"
            href={`/sessions/${p.resulting_session_id}`}
          >
            Xem buổi chơi
          </Link>
        </div>
      )}
      <div className="poll-choice-list">
        {options?.map((o, i) => {
          const yes = count(o.id, "yes"),
            answered =
              votes?.filter(
                (v) => v.option_id === o.id && active.has(v.member_id),
              ).length || 0;
          return (
            <section
              className="panel poll-choice"
              key={o.id}
              aria-label={`Khung giờ ${i + 1}`}
            >
              <div className="poll-choice-heading">
                <div>
                  <small>Lựa chọn {i + 1}</small>
                  <h2>
                    {date(o.starts_at)} – {date(o.ends_at)}
                  </h2>
                </div>
                {yes > 0 && yes === max && (
                  <span className="poll-best">Nhiều người chọn</span>
                )}
              </div>
              <div
                className="poll-meter"
                role="meter"
                aria-label="Số người đi được"
                aria-valuenow={yes}
                aria-valuemin={0}
                aria-valuemax={Math.max(1, active.size)}
              >
                <span
                  style={{
                    width: `${(yes / Math.max(1, active.size)) * 100}%`,
                  }}
                />
              </div>
              <div className="poll-result-summary">
                <strong>{yes} đi được</strong>
                <span>{count(o.id, "maybe")} có thể</span>
                <span>{count(o.id, "no")} không đi</span>
                <span>{active.size - answered} chưa trả lời</span>
              </div>
              {open && !loadError ? (
                <PollVoteButtons
                  key={`${o.id}:${votes?.find((v) => v.option_id === o.id && v.member_id === mine?.id)?.answer || ""}`}
                  optionId={o.id}
                  answer={
                    votes?.find(
                      (v) => v.option_id === o.id && v.member_id === mine?.id,
                    )?.answer
                  }
                />
              ) : (
                <p className="field-hint">
                  Lựa chọn của bạn:{" "}
                  {(
                    {
                      yes: "Đi được",
                      maybe: "Có thể",
                      no: "Không đi",
                    } as Record<string, string>
                  )[
                    votes?.find(
                      (v) => v.option_id === o.id && v.member_id === mine?.id,
                    )?.answer || ""
                  ] || "Chưa trả lời"}
                </p>
              )}
              <details className="poll-voters">
                <summary>Ai đã chọn?</summary>
                {[
                  ["yes", "Đi được"],
                  ["maybe", "Có thể"],
                  ["no", "Không đi"],
                  ["pending", "Chưa trả lời"],
                ].map(([answer, label]) => (
                  <p key={answer}>
                    <strong>{label}: </strong>
                    {members
                      ?.filter((m) =>
                        answer === "pending"
                          ? !votes?.some(
                              (v) =>
                                v.option_id === o.id && v.member_id === m.id,
                            )
                          : votes?.some(
                              (v) =>
                                v.option_id === o.id &&
                                v.member_id === m.id &&
                                v.answer === answer,
                            ),
                      )
                      .map((m) => m.display_name)
                      .join(", ") || "—"}
                  </p>
                ))}
              </details>
              {!p.resulting_session_id &&
                Date.parse(o.starts_at) > now &&
                !loadError && (
                  <Link
                    className="secondary poll-create-session"
                    href={`/sessions/new?poll=${p.id}&option=${o.id}`}
                  >
                    Tạo buổi với khung giờ này
                  </Link>
                )}
            </section>
          );
        })}
      </div>
      {open && (p.created_by === user.id || mine?.role === "admin") && (
        <ActionForm action={finishPoll} label="Đóng thăm dò">
          <input type="hidden" name="id" value={p.id} />
          <small>
            Ngừng nhận phiếu, giữ kết quả. Bạn vẫn có thể dùng kết quả để tạo
            buổi.
          </small>
        </ActionForm>
      )}
    </main>
  );
}
export const metadata = { title: "Chi tiết thăm dò" };
