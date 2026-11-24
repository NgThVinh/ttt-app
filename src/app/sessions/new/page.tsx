import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SessionForm from "@/components/session-form";
import { z } from "zod";
import { pollDraftSchema, type PollMeetingDraft } from "@/lib/poll-draft";
import { expenseToolsSchema, type ExpenseTools } from "@/lib/expense-tools";
export default async function NewSession({
  searchParams,
}: {
  searchParams: Promise<{ poll?: string; option?: string }>;
}) {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const [
    { data: groups, error },
    { data: members },
    { data: recent },
    { data: profile },
    eventsResult,
  ] = await Promise.all([
    db.from("groups").select("id,name"),
    db
      .from("group_members")
      .select("id,group_id,display_name,user_id")
      .eq("status", "active"),
    db
      .from("sessions")
      .select("group_id,venue")
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("profiles")
      .select("bank_bin,bank_account_no,bank_account_name")
      .eq("id", user.id)
      .maybeSingle(),
    db
      .from("sessions")
      .select("id,group_id,title,starts_at,ends_at")
      .eq("status", "planned")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(150),
  ]);
  const query = await searchParams;
  let pollDraft: PollMeetingDraft | undefined,
    draftError = "";
  if (query.poll || query.option) {
    const source = z
      .object({ poll: z.uuid(), option: z.uuid() })
      .safeParse(query);
    if (!source.success)
      draftError = "Link thăm dò không hợp lệ. Hãy mở lại từ thăm dò.";
    else {
      const [{ data: poll }, { data: option }] = await Promise.all([
        db
          .from("polls")
          .select("id,group_id,title,venue,resulting_session_id")
          .eq("id", source.data.poll)
          .maybeSingle(),
        db
          .from("poll_options")
          .select("id,poll_id,starts_at,ends_at")
          .eq("id", source.data.option)
          .eq("poll_id", source.data.poll)
          .maybeSingle(),
      ]);
      if (poll?.resulting_session_id)
        redirect(`/sessions/${poll.resulting_session_id}`);
      if (
        !poll ||
        !option ||
        Date.parse(option.starts_at) <= new Date().getTime()
      )
        draftError =
          "Thăm dò hoặc khung giờ không còn khả dụng. Hãy chọn lại khung tương lai.";
      else {
        const { data: votes, error: voteError } = await db
          .from("poll_votes")
          .select("member_id")
          .eq("option_id", option.id)
          .eq("answer", "yes");
        const allowed = new Set(
          (members || [])
            .filter((m) => m.group_id === poll.group_id)
            .map((m) => m.id),
        );
        const parsed = pollDraftSchema.safeParse({
          pollId: poll.id,
          optionId: option.id,
          groupId: poll.group_id,
          title: poll.title,
          venue: poll.venue,
          starts: option.starts_at,
          ends: option.ends_at,
          invitees: (votes || [])
            .map((v) => v.member_id)
            .filter((id) => allowed.has(id)),
        });
        if (voteError || !parsed.success)
          draftError = "Chưa tải được kết quả để điền sẵn. Hãy thử lại.";
        else pollDraft = parsed.data;
      }
    }
  }
  const suggestions: Record<string, { venue: string }> = {};
  for (const session of recent || []) {
    if (
      !suggestions[session.group_id] &&
      session.venue &&
      session.venue !== "Chưa chọn sân"
    )
      suggestions[session.group_id] = { venue: session.venue };
  }
  const toolsByGroup: Record<string, ExpenseTools> = {};
  await Promise.all(
    (groups || []).map(async (g) => {
      const { data } = await db.rpc("expense_tools", { g: g.id });
      const parsed = expenseToolsSchema.safeParse(data);
      if (parsed.success) toolsByGroup[g.id] = parsed.data;
    }),
  );
  return (
    <main>
      <div className="page-heading">
        <h1>Tạo buổi chơi</h1>
        <Link className="quiet-link" href="/sessions">
          Về lịch nhóm
        </Link>
      </div>
      {draftError ? (
        <section className="panel">
          <p role="alert">{draftError}</p>
          <Link href="/polls">Về thăm dò</Link>
        </section>
      ) : error ? (
        <p role="alert">Chưa tải được nhóm.</p>
      ) : !groups?.length ? (
        <p>
          Bạn cần tham gia nhóm trước. <Link href="/groups">Xem nhóm</Link>
        </p>
      ) : (
        <>
          {(eventsResult.error?.code === "42703" ||
            eventsResult.error?.code === "PGRST204") && (
            <p role="alert">
              Chức năng đặt lịch đang chờ cập nhật hệ thống. Lịch mới chưa thể
              lưu ở cấu hình hiện tại; vui lòng báo quản trị ứng dụng.
            </p>
          )}
          {pollDraft && (
            <aside className="poll-prefill-notice">
              <strong>Điền sẵn từ thăm dò</strong>
              <p>
                Kiểm tra lại giờ, địa điểm và người được mời. Chỉ khi bấm Tạo
                lịch mới lưu buổi; người được mời vẫn tự nhận lời.
              </p>
              <Link href={`/polls/${pollDraft.pollId}`}>
                Về kết quả thăm dò
              </Link>
            </aside>
          )}
          <SessionForm
            pollDraft={pollDraft}
            userId={user.id}
            groups={groups}
            members={members || []}
            toolsByGroup={toolsByGroup}
            initialTime={new Date().toISOString()}
            suggestions={suggestions}
            events={eventsResult.data || []}
            bankReady={
              !!(
                profile?.bank_bin &&
                profile?.bank_account_no &&
                profile?.bank_account_name
              )
            }
          />
        </>
      )}
    </main>
  );
}
export const metadata = { title: "Tạo buổi chơi" };
