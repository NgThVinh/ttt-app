import "server-only";
import { z } from "zod";
import type { supabase } from "./supabase";
import type { CalendarPoll } from "./calendar-overview";

const schema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    venue: z.string(),
    closes_at: z.string(),
    group: z.object({ name: z.string() }),
    options: z.array(
      z.object({ id: z.string(), starts_at: z.string(), ends_at: z.string() }),
    ),
  }),
);
export async function loadCalendarPolls(
  db: Awaited<ReturnType<typeof supabase>>,
): Promise<{ polls: CalendarPoll[]; error: boolean }> {
  const result = await db
    .from("polls")
    .select(
      "id,title,venue,closes_at,group:groups(name),options:poll_options(id,starts_at,ends_at)",
    )
    .eq("status", "open")
    .gt("closes_at", new Date().toISOString());
  const parsed = schema.safeParse(result.data);
  if (result.error || !parsed.success) return { polls: [], error: true };
  return {
    error: false,
    polls: parsed.data.map(({ group, ...poll }) => ({
      ...poll,
      group_name: group.name,
    })),
  };
}
