import { supabase } from "@/lib/supabase";
import Dashboard from "@/components/dashboard";
import { z } from "zod";
import { moneySchema } from "@/lib/schemas";
import { redirect } from "next/navigation";
import { profileName } from "@/lib/profile-name";
import { appName } from "@/lib/config";
export const metadata = { title: { absolute: `Trang chủ · ${appName}` } };
export default async function Home() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const [groups, sessions, wallet, profile] = await Promise.all([
    db.from("groups").select("id,name,sport"),
    db
      .from("sessions")
      .select("id,title,venue,starts_at,status")
      .order("starts_at", { ascending: false })
      .limit(30),
    db.rpc("my_settlements"),
    db.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
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
        profileName(profile.data?.display_name, user.user_metadata) || "bạn"
      }
      summary={summary}
      groups={groups.data || []}
      sessions={sessions.data || []}
      setupError={!!groups.error}
    />
  );
}
