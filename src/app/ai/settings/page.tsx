import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { envAllowsSuperAdmin } from "@/lib/super-admin-config.mjs";
import ActionForm from "@/components/action-form";
import { requestAI, configureAI } from "./actions";
import { z } from "zod";
export default async function AISettings() {
  const db = await supabase(),
    {
      data: { user },
    } = await db.auth.getUser();
  if (!user) redirect("/login");
  const isSuper =
    envAllowsSuperAdmin(
      user.email,
      user.email_confirmed_at,
      process.env.SUPER_ADMIN_EMAILS,
    ) && (await db.rpc("is_super_admin")).data === true;
  const [{ data: groups }, { data: settings }, { data: members }] =
    await Promise.all([
      db.from("groups").select("id,name"),
      db.from("group_ai_settings").select("*"),
      db
        .from("group_members")
        .select("group_id,role")
        .eq("user_id", user.id)
        .eq("status", "active"),
    ]);
  const directory = isSuper
    ? z
        .array(z.object({ id: z.uuid(), name: z.string() }))
        .safeParse((await db.rpc("ai_admin_groups")).data)
    : null;
  const visibleGroups = [...(groups || [])];
  if (directory?.success)
    for (const group of directory.data)
      if (!visibleGroups.some((g) => g.id === group.id))
        visibleGroups.push(group);
  return (
    <main>
      <Link href="/groups">Nhóm</Link>
      <h1>AI theo nhóm</h1>
      <p>
        AI chỉ hoạt động khi nhóm được duyệt và có key riêng. Hạn mức tính theo
        ngày tại Việt Nam.
      </p>
      {visibleGroups.map((g) => {
        const s = settings?.find((s) => s.group_id === g.id),
          admin = members?.some(
            (m) => m.group_id === g.id && m.role === "admin",
          );
        return (
          <section className="panel" key={g.id}>
            <h2>{g.name}</h2>
            <p>
              {s
                ? `${s.status} · ${s.enabled ? "Đang bật" : "Đang tắt"}`
                : "Chưa yêu cầu bật AI"}
              {s?.key_suffix ? ` · Key kết thúc ${s.key_suffix}` : ""}
            </p>
            {admin && (!s || ["rejected", "revoked"].includes(s.status)) && (
              <ActionForm action={requestAI} label="Yêu cầu bật AI">
                <input type="hidden" name="g" value={g.id} />
                <label>
                  Lý do
                  <input name="reason" required maxLength={500} />
                </label>
              </ActionForm>
            )}
            {isSuper && s && (
              <ActionForm
                action={configureAI}
                label="Lưu quyết định và cấu hình"
              >
                <input type="hidden" name="g" value={g.id} />
                <input
                  type="hidden"
                  name="revision"
                  value={String(s.revision)}
                />
                <input type="hidden" name="suffix" value={s.key_suffix || ""} />
                <p>Yêu cầu: {s.request_reason}</p>
                <label>
                  Quyết định
                  <select
                    name="status"
                    defaultValue={
                      s.status === "requested" ? "approved" : s.status
                    }
                  >
                    <option value="approved">Duyệt</option>
                    <option value="rejected">Từ chối</option>
                    <option value="revoked">Thu hồi và xóa key</option>
                  </select>
                </label>
                <label>
                  Provider
                  <select name="provider" defaultValue={s.provider || "google"}>
                    <option value="google">Gemini</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="openai-compatible">OpenAI-compatible</option>
                  </select>
                </label>
                <label>
                  Model
                  <input
                    name="model"
                    required
                    maxLength={120}
                    defaultValue={s.model || "gemini-3.8-flash"}
                  />
                </label>
                <label>
                  Base URL (chỉ OpenAI-compatible)
                  <input
                    name="base_url"
                    type="url"
                    defaultValue={s.base_url || ""}
                  />
                </label>
                <label>
                  API key mới (để trống giữ key hiện tại)
                  <input
                    name="key"
                    type="password"
                    autoComplete="new-password"
                    maxLength={4000}
                  />
                </label>
                <label>
                  Tin mỗi người/ngày
                  <input
                    name="message_limit"
                    type="number"
                    min={1}
                    max={500}
                    required
                    defaultValue={s.message_limit}
                  />
                </label>
                <label>
                  Token mỗi nhóm/ngày
                  <input
                    name="token_limit"
                    type="number"
                    min={1000}
                    max={10000000}
                    required
                    defaultValue={s.token_limit}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={s.enabled}
                  />
                  Bật AI
                </label>
                <label>
                  Lý do quyết định
                  <input name="reason" required maxLength={500} />
                </label>
              </ActionForm>
            )}
          </section>
        );
      })}
    </main>
  );
}
