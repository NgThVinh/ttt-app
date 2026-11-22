"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import type { FormResult } from "@/components/action-form";
async function identity() {
  const db = await supabase();
  if (!(await db.auth.getUser()).data.user) redirect("/login");
  return db;
}
const base = z.object({
  group_id: z.uuid(),
  target: z.uuid().or(z.literal("")),
  reason: z.string().trim().min(1).max(500),
});
export async function saveCategory(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const parsed = base
    .extend({
      name: z.string().trim().min(1).max(80),
      icon: z.enum([
        "water",
        "ball",
        "gear",
        "parking",
        "food",
        "discount",
        "other",
      ]),
      sort_order: z.coerce.number().int().min(0).max(1000),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { message: "Kiểm tra tên danh mục, thứ tự và lý do." };
  const p = parsed.data;
  const { error } = await db.rpc("save_expense_category", {
    g: p.group_id,
    target: p.target || null,
    name_text: p.name,
    icon_text: p.icon,
    sort_position: p.sort_order,
    enabled: form.has("active"),
    reason: p.reason,
  });
  if (error)
    return {
      message:
        "Không lưu được danh mục. Kiểm tra quyền admin và tên đã tồn tại.",
    };
  revalidatePath(`/groups/${p.group_id}`);
  return { ok: true, message: "Đã lưu danh mục, giữ lịch sử các khoản cũ." };
}
export async function saveTemplate(
  _state: FormResult,
  form: FormData,
): Promise<FormResult> {
  const db = await identity();
  const parsed = base
    .extend({
      title: z.string().trim().min(1).max(160),
      category_id: z.uuid().or(z.literal("")),
      amount: z.string().regex(/^-?\d+$/),
      mode: z.enum(["total", "per_person"]),
      split: z.enum(["equal", "weighted"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { message: "Kiểm tra tên mẫu, danh mục, số tiền và lý do." };
  const p = parsed.data;
  const { error } = await db.rpc("save_expense_template", {
    g: p.group_id,
    target: p.target || null,
    title_text: p.title,
    category: p.category_id || null,
    amount_text: p.amount,
    mode: p.mode,
    split: p.split,
    enabled: form.has("active"),
    reason: p.reason,
  });
  if (error)
    return {
      message:
        "Không lưu được mẫu. Kiểm tra quyền admin, danh mục và tên trùng.",
    };
  revalidatePath(`/groups/${p.group_id}`);
  return { ok: true, message: "Đã lưu mẫu thêm nhanh." };
}
