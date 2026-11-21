import { supabase } from "@/lib/supabase";
import Dashboard from "@/components/dashboard";
import { z } from "zod";
import { moneySchema } from "@/lib/schemas";
export default async function Home() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return <Dashboard demo />;
  const [groups, sessions, wallet] = await Promise.all([
    db.from("groups").select("id,name,sport"),
    db
      .from("sessions")
      .select("id,title,venue,starts_at,status")
      .order("starts_at", { ascending: false })
      .limit(30),
    db.rpc("my_settlements"),
  ]);
  const parsed = z
    .array(
      z.object({
        amount: moneySchema,
        mine_is_sender: z.boolean(),
        status: z.string(),
      }),
    )
    .safeParse(wallet.data);
  const outstanding = parsed.success
    ? parsed.data.filter((p) => p.status !== "confirmed")
    : null;
  const summary = outstanding
    ? {
        owe: outstanding
          .filter((p) => p.mine_is_sender)
          .reduce((n, p) => n + BigInt(p.amount), 0n)
          .toString(),
        owed: outstanding
          .filter((p) => !p.mine_is_sender)
          .reduce((n, p) => n + BigInt(p.amount), 0n)
          .toString(),
        payCount: outstanding.filter((p) => p.mine_is_sender).length,
        receiveCount: outstanding.filter((p) => !p.mine_is_sender).length,
      }
    : null;
  return (
    <Dashboard
      demo={false}
      name={
        typeof user.user_metadata.full_name === "string"
          ? user.user_metadata.full_name.split(" ")[0]
          : "bạn"
      }
      summary={summary}
      groups={groups.data || []}
      sessions={sessions.data || []}
      setupError={!!groups.error}
    />
  );
}
