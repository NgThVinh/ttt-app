import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ActionForm from "@/components/action-form";
import { createGroup } from "./actions";
import { randomUUID } from "node:crypto";
import { envAllowsSuperAdmin } from "@/lib/super-admin-config.mjs";
export default async function Groups() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await db.from("groups").select("id,name,sport");
  const envAllowed = envAllowsSuperAdmin(
    user.email,
    user.email_confirmed_at,
    process.env.SUPER_ADMIN_EMAILS,
  );
  const { data: databaseAllowed } = envAllowed
    ? await db.rpc("is_super_admin")
    : { data: false };
  const isSuper = envAllowed && databaseAllowed === true;
  return (
    <main>
      <Link href="/">Về trang chủ</Link>
      <h1>Nhóm của bạn</h1>
      {error && (
        <p role="alert">
          Chưa tải được dữ liệu. Kiểm tra kết nối và migration.
        </p>
      )}
      {data?.map((g) => (
        <section className="panel" key={g.id}>
          <Link href={`/groups/${g.id}`}>
            <h2>{g.name}</h2>
            <p>{g.sport}</p>
          </Link>
        </section>
      ))}
      {!data?.length && !error && (
        <p>Bạn chưa tham gia nhóm. Nhờ admin gửi link mời nhé.</p>
      )}
      {isSuper && (
        <section className="panel">
          <h2>Tạo nhóm mới</h2>
          <ActionForm action={createGroup} label="Tạo nhóm">
            <input type="hidden" name="request_key" value={randomUUID()} />
            <label htmlFor="name">Tên nhóm</label>
            <input id="name" name="name" maxLength={100} required />
            <label htmlFor="sport">Môn thể thao</label>
            <input
              id="sport"
              name="sport"
              maxLength={60}
              defaultValue="Cầu lông"
              required
            />
          </ActionForm>
        </section>
      )}
    </main>
  );
}
