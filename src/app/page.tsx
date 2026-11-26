import { supabase, currentUser } from "@/lib/supabase";
import Dashboard from "@/components/dashboard";
import { z } from "zod";
import { moneySchema } from "@/lib/schemas";
import { redirect } from "next/navigation";
import { profileName } from "@/lib/profile-name";
import { appName } from "@/lib/config";
import { loadUpcomingSessions } from "@/lib/load-session-overview";
import { activitySchema } from "@/lib/participation-activity";
export const metadata = { title: { absolute: `Trang chủ · ${appName}` } };
export default async function Home() {
  const db = await supabase();
  const user = await currentUser();
  if (!user) redirect("/login");
  const now = new Date().toISOString();
  const [sessions, wallet, profile, activity] = await Promise.all([
    loadUpcomingSessions(db, user.id, now),
    db.rpc("my_debt_summary"),
    db.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    db.rpc("my_participation_activity"),
  ]);
  const parsed = z
    .object({
      owe: moneySchema,
      owed: moneySchema,
      payCount: z.number().int().nonnegative(),
      receiveCount: z.number().int().nonnegative(),
    })
    .safeParse(wallet.data);
  const activityResult = activitySchema.safeParse(activity.data);
  return (
    <Dashboard
      demo={false}
      now={now}
      name={
        profileName(profile.data?.display_name, user.user_metadata) || "bạn"
      }
      summary={!wallet.error && parsed.success ? parsed.data : null}
      sessions={sessions.sessions}
      activity={
        !activity.error && activityResult.success ? activityResult.data : null
      }
      setupError={sessions.error || !!wallet.error || !parsed.success}
    />
  );
}
