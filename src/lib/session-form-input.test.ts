import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: async () => ({ auth: { getUser: mocks.user }, rpc: mocks.rpc }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error("redirect:" + url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { createSession } from "@/app/sessions/actions";

const memberA = "00000000-0000-4000-8000-000000000001";
const memberB = "00000000-0000-4000-8000-000000000002";
const session = "00000000-0000-4000-8000-000000000003";
function form() {
  mocks.user.mockResolvedValue({
    data: { user: { id: memberA } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: { id: session }, error: null });
  const data = new FormData();
  for (const [key, value] of Object.entries({
    groupId: memberA,
    title: "Test",
    venue: "Court",
    starts: "2026-11-23T18:00",
    flow: "played",
    court: " 400.000 ",
    reviewed: "yes",
    request_key: session,
    weights: JSON.stringify({ [memberA]: "1", [memberB]: "0,5" }),
    extras: JSON.stringify([
      {
        title: "Discount",
        amount: "-10,000",
        mode: "total",
        split: "equal",
        payer: memberA,
        beneficiaries: [memberA, memberB],
        values: [],
        reason: "Test",
      },
    ]),
  }))
    data.set(key, value);
  data.append("people", memberA);
  data.append("people", memberB);
  return data;
}
afterEach(() => vi.clearAllMocks());

it("normalizes localized input on the server before the authenticated financial gateway", async () => {
  await expect(createSession({ message: "" }, form())).rejects.toThrow(
    "redirect:/sessions/" + session,
  );
  expect(mocks.rpc).toHaveBeenCalledWith(
    "execute_financial_command",
    expect.objectContaining({
      command_name: "create_session_bundle",
      request_key: session,
      body: expect.objectContaining({
        court: "400000",
        weights: { [memberA]: "1", [memberB]: "0.5" },
        extras: [expect.objectContaining({ raw_amount: "-10000" })],
      }),
    }),
  );
});

it.each(["400000.5", "-5.000", "1.000.000.000.001"])(
  "rejects invalid court input %s before any financial mutation",
  async (court) => {
    const data = form();
    data.set("court", court);
    const result = await createSession({ message: "" }, data);
    expect(result.message.length).toBeGreaterThan(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);

it("rejects invalid weights even if the browser validation is bypassed", async () => {
  const data = form();
  data.set("weights", JSON.stringify({ [memberA]: "0", [memberB]: "1" }));
  expect((await createSession({ message: "" }, data)).message).toContain(
    "hệ số",
  );
  expect(mocks.rpc).not.toHaveBeenCalled();
});
