import "server-only";
import { z } from "zod";
import type { supabase } from "./supabase";
import type { SessionOverview } from "./session-overview";

const schema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    venue: z.string(),
    starts_at: z.string(),
    ends_at: z.string().nullable(),
    status: z.string(),
    revision: z.union([z.string(), z.number()]).transform(String),
    group: z.object({ name: z.string() }),
    attendees: z.array(
      z.object({
        member_id: z.string(),
        rsvp: z.string(),
        committed_at: z.string().nullable(),
        removed_at: z.string().nullable(),
      }),
    ),
  }),
);

export async function loadSessionOverview(
  db: Awaited<ReturnType<typeof supabase>>,
  userId: string,
): Promise<{ sessions: SessionOverview[]; error: boolean }> {
  const [result, membership] = await Promise.all([
    db
      .from("sessions")
      .select(
        "id,title,venue,starts_at,ends_at,status,revision,group:groups(name),attendees:session_attendees(member_id,rsvp,committed_at,removed_at)",
      )
      .order("starts_at", { ascending: false }),
    db
      .from("group_members")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "active"),
  ]);
  const parsed = schema.safeParse(result.data);
  if (result.error || membership.error || !parsed.success)
    return { sessions: [], error: true };
  const mine = new Set((membership.data || []).map((m) => m.id));
  return {
    error: false,
    sessions: parsed.data.map(({ attendees, group, ...session }) => {
      const active = attendees.filter((a) => !a.removed_at);
      const self = active.find((a) => mine.has(a.member_id));
      return {
        ...session,
        group_name: group.name,
        going: active.filter((a) => a.rsvp === "going" && a.committed_at)
          .length,
        pending: active.filter(
          (a) =>
            a.rsvp !== "not_going" && !(a.rsvp === "going" && a.committed_at),
        ).length,
        my_rsvp:
          self?.rsvp === "going" && self.committed_at
            ? "going"
            : self?.rsvp === "not_going"
              ? "not_going"
              : "pending",
      };
    }),
  };
}
