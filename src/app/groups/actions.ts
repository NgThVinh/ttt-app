"use server";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { groupSchema, inviteSchema, bankSchema } from "@/lib/group-schemas";
import type { FormResult } from "@/components/action-form";
import { envAllowsSuperAdmin } from "@/lib/super-admin-config.mjs";
async function identity() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  return { db, user };
}
export async function createGroup(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { db, user } = await identity();
  if (
    !envAllowsSuperAdmin(
      user.email,
      user.email_confirmed_at,
      process.env.SUPER_ADMIN_EMAILS,
    )
  )
    return { message: "Chỉ chủ ứng dụng được tạo nhóm." };
  const parsed = groupSchema
    .extend({ request_key: z.uuid() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { message: "Nhập tên nhóm và môn thể thao hợp lệ." };
  const { data, error } = await db.rpc("create_group", {
    group_name: parsed.data.name,
    group_sport: parsed.data.sport,
    request_key: parsed.data.request_key,
  });
  if (error)
    return {
      message: "Chưa tạo được nhóm. Kiểm tra migration và cấu hình server.",
    };
  redirect(`/groups/${data}`);
}
export async function createInvite(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { db } = await identity();
  const input = inviteSchema.safeParse(Object.fromEntries(form));
  if (!input.success)
    return { message: "Link mời cần hạn 1–30 ngày và 1–100 lượt." };
  const sessionId = form.get("session_id");
  if (sessionId) {
    if (!z.uuid().safeParse(sessionId).success)
      return { message: "Buổi không hợp lệ." };
    const { data: session } = await db
      .from("sessions")
      .select("id")
      .eq("id", String(sessionId))
      .eq("group_id", input.data.groupId)
      .eq("status", "planned")
      .maybeSingle();
    if (!session)
      return { message: "Buổi không thuộc nhóm hoặc đã chốt chi phí." };
  }
  const token = randomBytes(32).toString("hex");
  const { error } = await db.rpc("create_invite", {
    g: input.data.groupId,
    hashed_token: createHash("sha256").update(token).digest("hex"),
    valid_until: new Date(
      Date.now() + input.data.days * 86400000,
    ).toISOString(),
    use_limit: input.data.uses,
  });
  if (error)
    return {
      message:
        "Không tạo được link mời. Kiểm tra bạn còn trong nhóm, giới hạn link hoặc thử lại sau.",
    };
  return {
    ok: true,
    message: "Đã tạo link mời.",
    link: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/join/${token}${sessionId ? `?session=${sessionId}` : ""}`,
  };
}
export async function revokeInvite(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { db } = await identity();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { message: "Link không hợp lệ." };
  const { error } = await db.rpc("revoke_invite", { target: id.data });
  return error
    ? { message: "Không có quyền thu hồi link." }
    : { ok: true, message: "Đã thu hồi link mời." };
}
export async function manageMember(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { db } = await identity();
  const input = z
    .object({
      groupId: z.uuid(),
      target: z.uuid().optional(),
      operation: z.enum(["add", "remove", "admin", "member"]),
      label: z.string().trim().max(100).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Thông tin thành viên không hợp lệ." };
  const { error } = await db.rpc("manage_member", {
    g: input.data.groupId,
    target: input.data.target || null,
    operation: input.data.operation,
    label: input.data.label || null,
  });
  return error
    ? {
        message:
          "Không thực hiện được. Kiểm tra quyền admin; nhóm phải còn ít nhất một admin có tài khoản.",
      }
    : { ok: true, message: "Đã cập nhật thành viên." };
}
export async function acceptInvite(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { db } = await identity();
  const input = z
    .object({
      token: z.string().regex(/^[a-f0-9]{64}$/),
      claim_member: z.uuid().optional(),
      name: z.string().trim().min(1).max(100),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Thông tin tham gia không hợp lệ." };
  const { data, error } = await db.rpc("accept_invite_with_claim", {
    hashed_token: createHash("sha256").update(input.data.token).digest("hex"),
    member_name: input.data.name,
    claim_member: input.data.claim_member || null,
  });
  if (error)
    return {
      message:
        "Chưa tham gia được. Kiểm tra hiệu lực link mời và tên cũ; tên có thể đã được liên kết hoặc bạn có yêu cầu khác đang chờ.",
    };
  if (input.data.claim_member) redirect(`/groups/${data}#link-account`);
  const sessionId = form.get("session_id");
  if (z.uuid().safeParse(sessionId).success) {
    const { data: session } = await db
      .from("sessions")
      .select("id")
      .eq("id", String(sessionId))
      .eq("group_id", data)
      .eq("status", "planned")
      .maybeSingle();
    if (session) redirect(`/sessions/${session.id}`);
  }
  redirect(`/groups/${data}`);
}
export async function saveProfile(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { db, user } = await identity();
  const input = bankSchema.safeParse(Object.fromEntries(form));
  if (!input.success)
    return {
      message:
        "Tên hiển thị tối đa 100 ký tự. Chọn ngân hàng và điền số tài khoản, tên chủ tài khoản; hoặc để trống cả ba.",
    };
  const { error } = await db
    .from("profiles")
    .upsert({ id: user.id, ...input.data });
  return error
    ? { message: "Chưa lưu được hồ sơ. Kiểm tra migration và thử lại." }
    : { ok: true, message: "Đã lưu hồ sơ." };
}
export async function saveGuestBank(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { db } = await identity();
  const input = z
    .object({
      target: z.uuid(),
      bank_bin: z.string().regex(/^\d{6}$/),
      bank_account_no: z.string().regex(/^[A-Za-z0-9]{4,30}$/),
      bank_account_name: z.string().trim().min(1).max(100),
      reason: z.string().trim().min(1).max(500),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success)
    return {
      message: "Điền đủ ngân hàng, số tài khoản, tên chủ tài khoản và lý do.",
    };
  const p = input.data;
  const { error } = await db.rpc("set_guest_bank", {
    target: p.target,
    bank_bin_text: p.bank_bin,
    account_text: p.bank_account_no,
    name_text: p.bank_account_name,
    reason: p.reason,
  });
  return error
    ? {
        message:
          "Không lưu được. Kiểm tra quyền admin và trạng thái liên kết tài khoản.",
      }
    : {
        ok: true,
        message: "Đã lưu ngân hàng thành viên khách và thông báo cho nhóm.",
      };
}

export async function requestClaim(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { db } = await identity();
  const target = z.uuid().safeParse(form.get("target"));
  if (!target.success) return { message: "Thành viên không hợp lệ." };
  const { error } = await db.rpc("request_member_claim", {
    target: target.data,
  });
  if (!error) {
    revalidatePath("/groups", "layout");
    revalidatePath("/approvals");
  }
  return error
    ? {
        message:
          "Chưa gửi được. Kiểm tra email đã xác nhận, tên cũ hoặc yêu cầu đang chờ duyệt.",
      }
    : { ok: true, message: "Đã gửi yêu cầu cho admin xác minh." };
}
export async function decideClaim(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { db } = await identity();
  const input = z
    .object({ id: z.uuid(), decision: z.enum(["approve", "reject"]) })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Yêu cầu không hợp lệ." };
  const { error } = await db.rpc("decide_member_claim", {
    request_id: input.data.id,
    approve: input.data.decision === "approve",
  });
  if (!error) {
    revalidatePath("/groups", "layout");
    revalidatePath("/approvals");
  }
  return error
    ? {
        message:
          "Không thể duyệt: yêu cầu hết hạn, người tham gia đã thay đổi hoặc tài khoản mới đã có lịch sử cần xử lý thủ công.",
      }
    : { ok: true, message: "Đã xử lý yêu cầu." };
}

export async function cancelClaim(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { db, user } = await identity();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { message: "Yêu cầu không hợp lệ." };
  const { data } = await db
    .from("approval_requests")
    .select("id")
    .eq("id", id.data)
    .eq("type", "member_claim")
    .eq("requested_by", user.id)
    .maybeSingle();
  if (!data) return { message: "Không tìm thấy yêu cầu của bạn." };
  const { error } = await db.rpc("cancel_session_request", {
    request_id: id.data,
  });
  if (error)
    return {
      message:
        "Yêu cầu đã được xử lý hoặc bạn không còn trong nhóm. Hãy tải lại trang.",
    };
  revalidatePath("/groups", "layout");
  revalidatePath("/approvals");
  return { ok: true, message: "Đã hủy yêu cầu. Bạn có thể chọn lại tên." };
}
