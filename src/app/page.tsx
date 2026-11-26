import { supabase } from "@/lib/supabase";
import Dashboard from "@/components/dashboard";
import { z } from "zod";
import { moneySchema } from "@/lib/schemas";
import { redirect } from "next/navigation";
import { profileName } from "@/lib/profile-name";
import { appName } from "@/lib/config";
import { loadSessionOverview } from "@/lib/load-session-overview";
import { activitySchema } from "@/lib/participation-activity";
export const metadata = { title: { absolute: `Trang chủ · ${appName}` } };
export default async function Home() {
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const [groups, sessions, wallet, profile, activity] = await Promise.all([
    db.from("groups").select("id,name,sport"),
    loadSessionOverview(db, user.id),
    db.rpc("my_settlements"),
    db.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    db.rpc("my_participation_activity"),
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
  const activityResult = activitySchema.safeParse(activity.data);
  return (
    <Dashboard
      demo={false}
      now={new Date().toISOString()}
      name={
        profileName(profile.data?.display_name, user.user_metadata) || "bạn"
      }
      summary={summary}
      groups={groups.data || []}
      sessions={sessions.sessions}
      activity={
        !activity.error && activityResult.success ? activityResult.data : null
      }
      setupError={
        !!groups.error || sessions.error || !!wallet.error || !parsed.success
      }
    />
  );
}
