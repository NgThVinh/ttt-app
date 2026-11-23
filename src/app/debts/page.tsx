import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { moneySchema } from "@/lib/schemas";
import { formatMoney } from "@/lib/money";
const schema = z.array(
  z.object({
    id: z.uuid(),
    session_id: z.uuid(),
    session_title: z.string(),
    from_name: z.string(),
    to_name: z.string(),
    amount: moneySchema,
    status: z.string(),
    mine_is_sender: z.boolean(),
  }),
);
export default async function Debts() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await db.rpc("my_settlements");
  const parsed = schema.safeParse(data);
  if (error || !parsed.success)
    return (
      <main>
        <Link href="/">Trang chủ</Link>
        <p role="alert">
          Chưa tải được công nợ. Kiểm tra kết nối và migration.
        </p>
      </main>
    );
  const rows = parsed.data;
  const owe = rows
      .filter((r) => r.mine_is_sender && r.status !== "confirmed")
      .reduce((n, r) => n + BigInt(r.amount), 0n),
    owed = rows
      .filter((r) => !r.mine_is_sender && r.status !== "confirmed")
      .reduce((n, r) => n + BigInt(r.amount), 0n);
  return (
    <main>
      <Link href="/">Trang chủ</Link>
      <h1>Công nợ của tôi</h1>
      <section className="panel">
        <h2>Tôi cần trả: {formatMoney(owe)}</h2>
        <h2>Tôi cần thu: {formatMoney(owed)}</h2>
      </section>
      {!rows.length && <p>Bạn chưa có khoản thanh toán.</p>}
      {rows.map((r) => (
        <section className="panel" key={r.id}>
          <Link href={`/sessions/${r.session_id}`}>
            <h2>{r.session_title}</h2>
            <p>
              {r.from_name} trả {r.to_name} ·{" "}
              <strong>{formatMoney(r.amount)}</strong>
            </p>
            <p>
              {r.status === "confirmed"
                ? "Đã nhận"
                : r.status === "marked_paid"
                  ? "Chờ người nhận xác nhận"
                  : "Chưa trả"}
            </p>
          </Link>
        </section>
      ))}
    </main>
  );
}
export const metadata = { title: "Công nợ" };
