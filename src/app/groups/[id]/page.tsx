import Link from "@/components/app-link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import ActionForm from "@/components/action-form";
import ExpenseCatalogManager from "@/components/expense-catalog-manager";
import BankPicker from "@/components/bank-picker";
import MemberClaimPanel from "@/components/member-claim-panel";
import MemberClaimReview from "@/components/member-claim-review";
import { expenseToolsSchema } from "@/lib/expense-tools";
import {
  createInvite,
  revokeInvite,
  manageMember,
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
  const { data: invites } = members?.some(
    (m) => m.user_id === user.id && m.status === "active",
  )
    ? await db
        .from("invites")
        .select("id,expires_at,max_uses,uses,revoked_at")
        .eq("group_id", id)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };
  const [{ data: ownClaims }, reviewResult] = await Promise.all([
    db
      .from("approval_requests")
      .select("id,payload,status,expires_at")
      .eq("group_id", id)
      .eq("requested_by", user.id)
      .eq("type", "member_claim")
      .order("created_at", { ascending: false })
      .limit(1),
    admin
      ? db.rpc("member_claim_reviews", { g: id })
      : Promise.resolve({ data: [] }),
  ]);
  const reviewSchema = z.array(
    z.object({
      id: z.uuid(),
      member_id: z.uuid(),
      email: z.string().nullable(),
      email_verified: z.boolean(),
    }),
  );
  const reviews = reviewSchema.safeParse(reviewResult.data);
  return (
    <main>
      <Link href="/groups">Các nhóm</Link>
      <h1>{group.name}</h1>
      <p>{group.sport}</p>
      <MemberClaimPanel
        now={new Date().getTime()}
        email={user.email}
        admin={!!admin}
        claims={ownClaims || []}
        guests={(members || []).filter(
          (m) => !m.user_id && m.status === "active",
        )}
      />
      {admin && reviews.success && (
        <MemberClaimReview reviews={reviews.data} members={members || []} />
      )}
      {admin && !reviews.success && (
        <p role="alert">
          Chưa tải được yêu cầu liên kết. Vui lòng tải lại trang.
        </p>
      )}
      {members?.some((m) => m.user_id === user.id && m.status === "active") && (
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
                  {admin && (
                    <details>
                      <summary>Ngân hàng của {m.display_name}</summary>
                      <p>
                        Sau khi liên kết tài khoản, thành viên tự cập nhật ngân
                        hàng.
                      </p>
                      <ActionForm
                        action={saveGuestBank}
                        label="Lưu ngân hàng thành viên khách"
                      >
                        <input type="hidden" name="target" value={m.id} />
                        <BankPicker
                          required
                          defaultValue={
                            guestBanks?.find((x) => x.member_id === m.id)
                              ?.bank_bin || ""
                          }
                        />
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
export const metadata = { title: "Chi tiết nhóm" };
