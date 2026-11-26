import { it, expect } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { toolPalette } from "./tool-palette";
import { readTools } from "./read-tools";
import { draftTools } from "./draft-tools";
import type { supabase } from "@/lib/supabase";
const names = [
  "get_my_debts",
  "get_who_owes_me",
  "draft_mark_paid",
  "request_confirm_received",
  "draft_reminder",
  "list_sessions",
  "get_upcoming",
  "get_session_breakdown",
  "draft_rsvp",
  "draft_claim_collector",
  "request_session_change",
  "draft_expense",
  "draft_session",
  "get_group_summary",
];
const definitions = Object.fromEntries(
  names.map((n) => [n, tool({ description: n, inputSchema: z.object({}) })]),
);
it("reduces serialized production schemas for a common debt question", async () => {
  const fake = {} as Awaited<ReturnType<typeof supabase>>;
  const p = toolPalette(
    {
      ...readTools(
        fake,
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ),
      ...draftTools(fake, "11111111-1111-4111-8111-111111111111"),
    },
    "Tôi còn nợ ai?",
  );
  const active = (await p.prepareStep()).activeTools;
  const schemaChars = (names: string[]) =>
    JSON.stringify(
      names.map((name) => {
        const t = p.tools[name];
        return {
          name,
          description: t.description,
          schema:
            t.inputSchema instanceof z.ZodType
              ? z.toJSONSchema(t.inputSchema)
              : {},
        };
      }),
    ).length;
  const all = schemaChars(Object.keys(p.tools)),
    selected = schemaChars(active);
  expect(selected).toBeLessThan(all);
  console.log(
    JSON.stringify({
      toolPalette: {
        allSchemasChars: all,
        debtSchemasChars: selected,
        allTools: Object.keys(p.tools).length,
        debtTools: active.length,
      },
    }),
  );
});
it("sends a small initial set and keeps creation/expense schemas out of a debt query", async () => {
  const p = toolPalette(definitions, "Tôi còn nợ ai?"),
    active = (await p.prepareStep()).activeTools;
  expect(active).toContain("get_my_debts");
  expect(active).toContain("discover_tools");
  expect(active).not.toContain("draft_session");
  expect(active).not.toContain("draft_expense");
  expect(active.length).toBeLessThan(names.length);
});
it("can discover a missing family without introducing unregistered authority tools", async () => {
  const p = toolPalette(definitions, "Xin chào");
  await p.tools.discover_tools.execute!(
    { family: "expenses" },
    { toolCallId: "test", messages: [], context: {} },
  );
  expect((await p.prepareStep()).activeTools).toContain("draft_expense");
  await p.tools.discover_tools.execute!(
    { family: "all" },
    { toolCallId: "test", messages: [], context: {} },
  );
  const active = (await p.prepareStep()).activeTools;
  expect(active).not.toContain("approve");
  expect(active).not.toContain("set_bank");
  expect(active).toHaveLength(names.length + 1);
});
