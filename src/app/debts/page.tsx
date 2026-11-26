import Link from "@/components/app-link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { moneySchema } from "@/lib/schemas";
import { formatMoney } from "@/lib/money";
import { Table, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
        <p role="alert">Chưa tải được công nợ. Vui lòng thử lại.</p>
      </main>
    );
  const rows = [...parsed.data].sort(
    (a, b) =>
      Number(a.status === "confirmed") - Number(b.status === "confirmed"),
  );
  const owe = rows
      .filter((r) => r.mine_is_sender && r.status !== "confirmed")
      .reduce((n, r) => n + BigInt(r.amount), 0n),
    owed = rows
      .filter((r) => !r.mine_is_sender && r.status !== "confirmed")
      .reduce((n, r) => n + BigInt(r.amount), 0n);
  return (
    <main>
      <div className="page-heading">
        <h1>Công nợ của tôi</h1>
        <small>
          {rows.filter((r) => r.status !== "confirmed").length} khoản chưa xong
        </small>
      </div>
      <dl className="session-facts debt-facts">
        <div>
          <dt>Cần trả</dt>
          <dd className="money">{formatMoney(owe)}</dd>
        </div>
        <div>
          <dt>Cần thu</dt>
          <dd className="money">{formatMoney(owed)}</dd>
        </div>
      </dl>
      {!rows.length && <p>Bạn chưa có khoản thanh toán.</p>}
      {!!rows.length && (
        <Table aria-label="Bảng công nợ">
          <caption className="sr-only">
            Các khoản thanh toán · bấm tên buổi để xem và thanh toán
          </caption>
          <thead>
            <tr>
              <TableHead>Buổi chơi · Người chuyển → nhận</TableHead>
              <TableHead className="money">Số tiền</TableHead>
              <TableHead>Trạng thái</TableHead>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <TableCell>
                  <Link href={`/sessions/${r.session_id}`}>
                    {r.session_title}
                  </Link>
                  <small className="table-description">
                    {r.from_name} → {r.to_name}
                  </small>
                </TableCell>
                <TableCell className="money">
                  <strong>{formatMoney(r.amount)}</strong>
                </TableCell>
                <TableCell>
                  <Badge
                    tone={
                      r.status === "confirmed"
                        ? "success"
                        : r.status === "marked_paid"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {r.status === "confirmed"
                      ? "Đã nhận"
                      : r.status === "marked_paid"
                        ? "Chờ xác nhận"
                        : "Chưa trả"}
                  </Badge>
                </TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </main>
  );
}
export const metadata = { title: "Công nợ" };
