import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import ActionForm from "@/components/action-form";
import ExpenseCatalogManager from "@/components/expense-catalog-manager";
import { expenseToolsSchema } from "@/lib/expense-tools";
import {
  createInvite,
  revokeInvite,
  manageMember,
  requestClaim,
  decideClaim,
  saveGuestBank,
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
  const expenseTools = expenseToolsSchema.safeParse(
    (await db.rpc("expense_tools", { g: id })).data,
  );
  const { data: guestBanks } = await db
    .from("guest_bank_accounts")
    .select("member_id,bank_bin,bank_account_no,bank_account_name")
    .eq("group_id", id);
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
      {admin && (
        <section className="panel">
          <h2>Mời bạn</h2>
          <ActionForm action={createInvite} label="Tạo link mời">
            <input type="hidden" name="groupId" value={id} />
            <details>
              <summary>Tùy chỉnh link mời</summary>
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
            </details>
          </ActionForm>
          <details>
            <summary>Link đã tạo</summary>
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
          </details>
        </section>
      )}
      {admin && expenseTools.success && (
        <ExpenseCatalogManager groupId={id} tools={expenseTools.data} />
      )}
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
                <>
                  <ActionForm
                    action={requestClaim}
                    label="Đây là tôi — gửi yêu cầu xác minh"
                  >
                    <input type="hidden" name="target" value={m.id} />
                  </ActionForm>
                  {admin && (
                    <details>
                      <summary>Ngân hàng của {m.display_name}</summary>
                      <p>
                        Chỉ nhập hộ khi người này chưa có tài khoản. Khi liên
                        kết tài khoản, họ cần tự kiểm tra và lưu ngân hàng trong
                        hồ sơ.
                      </p>
                      <ActionForm
                        action={saveGuestBank}
                        label="Lưu ngân hàng thành viên khách"
                      >
                        <input type="hidden" name="target" value={m.id} />
                        <label>
                          Mã BIN ngân hàng
                          <input
                            name="bank_bin"
                            pattern="[0-9]{6}"
                            required
                            defaultValue={
                              guestBanks?.find((x) => x.member_id === m.id)
                                ?.bank_bin || ""
                            }
                          />
                        </label>
                        <label>
                          Số tài khoản
                          <input
                            name="bank_account_no"
                            pattern="[A-Za-z0-9]{4,30}"
                            required
                            defaultValue={
                              guestBanks?.find((x) => x.member_id === m.id)
                                ?.bank_account_no || ""
                            }
                          />
                        </label>
                        <label>
                          Tên chủ tài khoản
                          <input
                            name="bank_account_name"
                            required
                            maxLength={100}
                            defaultValue={
                              guestBanks?.find((x) => x.member_id === m.id)
                                ?.bank_account_name || ""
                            }
                          />
                        </label>
                        <label>
                          Lý do nhập hoặc sửa
                          <input name="reason" required maxLength={500} />
                        </label>
                      </ActionForm>
                    </details>
                  )}
                </>
              )}
              {admin && m.status === "active" && (
                <details>
                  <summary>Quản lý {m.display_name}</summary>
                  <ActionForm action={manageMember} label="Cập nhật">
                    <input type="hidden" name="groupId" value={id} />
                    <input type="hidden" name="target" value={m.id} />
                    <select
                      name="operation"
                      aria-label={`Thao tác với ${m.display_name}`}
                      required
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Chọn thao tác
                      </option>
                      <option value="member">Đặt làm thành viên</option>
                      {m.user_id && (
                        <option value="admin">Đặt làm admin nhóm</option>
                      )}
                      <option value="remove">Gỡ khỏi nhóm, giữ lịch sử</option>
                    </select>
                  </ActionForm>
                </details>
              )}
            </div>
          </article>
        ))}
      </section>
      {admin && (
        <>
          {!!claims?.length && (
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
          )}
          <details className="panel">
            <summary>Thêm người chưa có tài khoản</summary>
            <ActionForm action={manageMember} label="Thêm thành viên">
              <input type="hidden" name="groupId" value={id} />
              <input type="hidden" name="operation" value="add" />
              <label htmlFor="member-name">Tên thành viên</label>
              <input id="member-name" name="label" required maxLength={100} />
            </ActionForm>
          </details>
        </>
      )}
    </main>
  );
}
