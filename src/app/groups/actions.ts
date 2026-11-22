"use server";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { redirect } from "next/navigation";
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
        "Không tạo được link mời. Kiểm tra quyền admin hoặc thử lại sau.",
    };
  return {
    ok: true,
    message: "Đã tạo link mời.",
    link: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/join/${token}`,
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
      name: z.string().trim().min(1).max(100),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { message: "Thông tin tham gia không hợp lệ." };
  const { data, error } = await db.rpc("accept_invite", {
    hashed_token: createHash("sha256").update(input.data.token).digest("hex"),
    member_name: input.data.name,
  });
  if (error)
    return {
      message:
        "Link đã hết hạn, hết lượt, bị thu hồi hoặc bạn đã được gỡ khỏi nhóm.",
    };
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
        "Tên tối đa 100 ký tự. Điền đủ ba thông tin ngân hàng hoặc để trống cả ba; mã BIN gồm 6 số.",
    };
  const { error } = await db
    .from("profiles")
    .upsert({ id: user.id, ...input.data });
  return error
    ? { message: "Chưa lưu được hồ sơ. Kiểm tra migration và thử lại." }
    : { ok: true, message: "Đã lưu hồ sơ." };
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
  return error
    ? { message: "Chưa gửi được. Bạn có thể đang có yêu cầu chờ duyệt." }
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
  return error
    ? {
        message:
          "Không thể duyệt: yêu cầu hết hạn, người tham gia đã thay đổi hoặc tài khoản mới đã có lịch sử cần xử lý thủ công.",
      }
    : { ok: true, message: "Đã xử lý yêu cầu." };
}
