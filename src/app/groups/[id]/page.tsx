import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import ActionForm from "@/components/action-form";
import {
  createInvite,
  revokeInvite,
  manageMember,
  requestClaim,
  decideClaim,
} from "../actions";
export default async function Group({
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
  const { data: group } = await db
    .from("groups")
    .select("id,name,sport")
    .eq("id", id)
    .maybeSingle();
  if (!group) notFound();
  const { data: members } = await db
    .from("group_members")
    .select("id,user_id,display_name,role,status")
    .eq("group_id", id);
  const admin = members?.some(
    (m) => m.user_id === user.id && m.status === "active" && m.role === "admin",
  );
  const { data: invites } = admin
    ? await db
        .from("invites")
        .select("id,expires_at,max_uses,uses,revoked_at")
        .eq("group_id", id)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };
  const { data: claims } = admin
    ? await db
        .from("approval_requests")
        .select("id,payload,requested_by,expires_at")
        .eq("group_id", id)
        .eq("type", "member_claim")
        .eq("status", "pending")
    : { data: [] };
  return (
    <main>
      <Link href="/groups">Các nhóm</Link>
      <h1>{group.name}</h1>
      <p>{group.sport}</p>
      <section className="panel">
        <h2>Thành viên</h2>
        {members?.map((m) => (
          <article className="session-row" key={m.id}>
            <div>
              <strong>{m.display_name}</strong>
              <small>
                {m.status === "removed"
                  ? "Đã gỡ"
                  : m.role === "admin"
                    ? "Admin nhóm"
                    : "Thành viên"}
                {!m.user_id ? " · Chưa có tài khoản" : ""}
              </small>
              {!m.user_id && m.status === "active" && (
                <ActionForm
                  action={requestClaim}
                  label="Đây là tôi — gửi yêu cầu xác minh"
                >
                  <input type="hidden" name="target" value={m.id} />
                </ActionForm>
              )}
              {admin && m.status === "active" && (
                <ActionForm action={manageMember} label="Cập nhật">
                  <input type="hidden" name="groupId" value={id} />
                  <input type="hidden" name="target" value={m.id} />
                  <select
                    name="operation"
                    aria-label={`Thao tác với ${m.display_name}`}
                  >
                    <option value="member">Thành viên</option>
                    {m.user_id && <option value="admin">Admin nhóm</option>}
                    <option value="remove">Gỡ khỏi nhóm, giữ lịch sử</option>
                  </select>
                </ActionForm>
              )}
            </div>
          </article>
        ))}
      </section>
      {admin && (
        <>
          <section className="panel">
            <h2>Chờ admin xác minh thành viên</h2>
            {!claims?.length && <p>Không có yêu cầu đang chờ.</p>}
            {claims?.map((r) => (
              <div className="session-row" key={r.id}>
                <div>
                  <p>
                    {members?.find((m) => m.user_id === r.requested_by)
                      ?.display_name || "Thành viên"}{" "}
                    muốn nhận lại{" "}
                    {members?.find((m) => m.id === r.payload.member_id)
                      ?.display_name || "thành viên cũ"}
                    . Hãy xác minh đúng người trước khi duyệt.
                  </p>
                  <ActionForm action={decideClaim} label="Xử lý yêu cầu">
                    <input type="hidden" name="id" value={r.id} />
                    <select name="decision" aria-label="Quyết định xác minh">
                      <option value="reject">Từ chối</option>
                      <option value="approve">
                        Đã xác minh — đồng ý liên kết
                      </option>
                    </select>
                  </ActionForm>
                </div>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>Thêm người chưa có tài khoản</h2>
            <ActionForm action={manageMember} label="Thêm thành viên">
              <input type="hidden" name="groupId" value={id} />
              <input type="hidden" name="operation" value="add" />
              <label htmlFor="member-name">Tên thành viên</label>
              <input id="member-name" name="label" required maxLength={100} />
            </ActionForm>
          </section>
          <section className="panel">
            <h2>Link mời</h2>
            <ActionForm action={createInvite} label="Tạo link mời">
              <input type="hidden" name="groupId" value={id} />
              <label htmlFor="days">Có hiệu lực trong (ngày)</label>
              <input
                id="days"
                name="days"
                type="number"
                min="1"
                max="30"
                defaultValue="7"
                required
              />
              <label htmlFor="uses">Số lượt dùng</label>
              <input
                id="uses"
                name="uses"
                type="number"
                min="1"
                max="100"
                defaultValue="30"
                required
              />
            </ActionForm>
            {invites?.map((i) => (
              <div className="session-row" key={i.id}>
                <div>
                  <p>
                    {i.uses}/{i.max_uses} lượt · Hết hạn{" "}
                    {new Date(i.expires_at).toLocaleString("vi-VN", {
                      timeZone: "Asia/Ho_Chi_Minh",
                    })}
                  </p>
                  {i.revoked_at ? (
                    <p>Đã thu hồi</p>
                  ) : (
                    <ActionForm action={revokeInvite} label="Thu hồi">
                      <input type="hidden" name="id" value={i.id} />
                    </ActionForm>
                  )}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
