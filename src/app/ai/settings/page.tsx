import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { verifiedSuperAdmin } from "@/lib/super-admin-access";
import ActionForm from "@/components/action-form";
import { configureAI, configureDecisionRouting, toggleAI } from "./actions";
import { z } from "zod";
export default async function AISettings() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const isSuper = await verifiedSuperAdmin(db);
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
  const visible = [...(groups || [])];
  if (directory?.success)
    for (const g of directory.data)
      if (!visible.some((x) => x.id === g.id)) visible.push(g);
  return (
    <main>
      <Link href="/groups">Nhóm</Link>
      <h1>Cài đặt trợ lý AI</h1>
      {visible.map((g) => {
        const s = settings?.find((x) => x.group_id === g.id),
          admin =
            isSuper ||
            members?.some((m) => m.group_id === g.id && m.role === "admin");
        return (
          <section className="panel" key={g.id} data-group-id={g.id}>
            <div className="section-heading">
              <h2>{g.name}</h2>
              <strong>
                {s?.enabled ? "Đang bật" : s ? "Đang tắt" : "Chưa cấu hình"}
              </strong>
            </div>
            {admin && s && (
              <ActionForm
                action={toggleAI}
                label={s.enabled ? "Tắt AI" : "Bật AI"}
              >
                <input type="hidden" name="g" value={g.id} />
                <input
                  type="hidden"
                  name="revision"
                  value={String(s.revision)}
                />
                <input
                  type="hidden"
                  name="enabled"
                  value={s.enabled ? "false" : "true"}
                />
              </ActionForm>
            )}
            {admin ? (
              <details open={!s}>
                <summary>Cấu hình provider, key và hạn mức</summary>
                <ActionForm
                  action={configureAI}
                  label="Lưu cấu hình AI"
                  preserveValues
                >
                  <input type="hidden" name="g" value={g.id} />
                  <input
                    type="hidden"
                    name="revision"
                    value={String(s?.revision ?? -1)}
                  />
                  <input type="hidden" name="status" value="approved" />
                  <input
                    type="hidden"
                    name="suffix"
                    value={s?.key_suffix || ""}
                  />
                  <label>
                    Provider
                    <select
                      name="provider"
                      defaultValue={s?.provider || "google"}
                    >
                      <option value="google">Gemini</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="openai-compatible">
                        OpenAI-compatible
                      </option>
                    </select>
                  </label>
                  <label>
                    Model
                    <input
                      name="model"
                      required
                      maxLength={120}
                      defaultValue={s?.model || ""}
                      placeholder="ID model của provider"
                    />
                  </label>
                  <label>
                    Base URL (chỉ OpenAI-compatible)
                    <input
                      name="base_url"
                      type="url"
                      defaultValue={s?.base_url || ""}
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
                  {s?.key_suffix && (
                    <small>Key hiện tại kết thúc {s.key_suffix}</small>
                  )}
                  <label>
                    Tin mỗi người/ngày
                    <input
                      name="message_limit"
                      type="number"
                      min="1"
                      max="500"
                      required
                      defaultValue={s?.message_limit || 30}
                    />
                  </label>
                  <label>
                    Token mỗi nhóm/ngày
                    <input
                      name="token_limit"
                      type="number"
                      min="1000"
                      max="10000000"
                      required
                      defaultValue={s?.token_limit || 100000}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={s?.enabled || false}
                    />
                    Bật AI sau khi lưu
                  </label>
                  <label>
                    Lý do cập nhật
                    <input
                      name="reason"
                      required
                      maxLength={500}
                      defaultValue="Cập nhật cấu hình AI"
                    />
                  </label>
                </ActionForm>
              </details>
            ) : (
              <p>Liên hệ admin nhóm để thay đổi cấu hình.</p>
            )}
            {admin &&
              s?.enabled &&
              s.provider === "openai-compatible" &&
              s.base_url === "https://openrouter.ai/api/v1" && (
                <details>
                  <summary>Định tuyến ý định</summary>
                  <ActionForm
                    action={configureDecisionRouting}
                    label="Lưu định tuyến"
                  >
                    <input type="hidden" name="g" value={g.id} />
                    <input
                      type="hidden"
                      name="revision"
                      value={String(s.revision)}
                    />
                    <label>
                      Model quyết định (trống để tắt)
                      <input
                        name="model"
                        defaultValue={s.decision_model || ""}
                      />
                    </label>
                    <label>
                      Lý do
                      <input
                        name="reason"
                        required
                        maxLength={500}
                        defaultValue="Cập nhật định tuyến"
                      />
                    </label>
                  </ActionForm>
                </details>
              )}
          </section>
        );
      })}
    </main>
  );
}
export const metadata = { title: "Cài đặt trợ lý AI" };
