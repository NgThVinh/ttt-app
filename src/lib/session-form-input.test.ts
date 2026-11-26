import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: async () => ({ auth: { getUser: mocks.user }, rpc: mocks.rpc }),
}));
vi.mock("next/navigation", () => ({
  RedirectType: { replace: "replace", push: "push" },
  redirect: (url: string) => {
    throw new Error("redirect:" + url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { createSession, scheduleMeeting } from "@/app/sessions/actions";
import { revalidatePath } from "next/cache";

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

it("schedules a meeting with pending invitations and Vietnamese time, without accepting for other people", async () => {
  const data = form();
  data.set("ends", "2026-11-23T20:00");
  data.set("note", "");
  data.set("collectorMode", "unknown");
  data.set("nominee", "");
  data.append("invitees", memberB);
  await expect(scheduleMeeting({ message: "" }, data)).rejects.toThrow(
    "redirect:/sessions/" + session,
  );
  expect(mocks.rpc).toHaveBeenCalledWith("schedule_calendar_meeting", {
    request_key: session,
    source_poll: null,
    chosen_option: null,
    body: expect.objectContaining({
      start_time: "2026-11-23T18:00:00+07:00",
      ends_at: "2026-11-23T20:00:00+07:00",
      be_collector: false,
      invitees: [memberB],
      repeat_weeks: 0,
    }),
  });
});
it("rejects an invalid meeting interval before writing to the database", async () => {
  const data = form();
  data.set("ends", "2026-11-23T17:00");
  data.set("note", "");
  data.set("collectorMode", "unknown");
  data.set("nominee", "");
  expect((await scheduleMeeting({ message: "" }, data)).message).toContain(
    "kết thúc",
  );
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("explains an unavailable scheduling RPC without pretending the date or invitations are wrong", async () => {
  const data = form();
  data.set("ends", "2026-11-23T20:00");
  data.set("note", "");
  data.set("collectorMode", "unknown");
  data.set("nominee", "");
  mocks.rpc.mockResolvedValue({
    data: null,
    error: {
      code: "PGRST202",
      message: "Could not find the function public.schedule_meeting",
    },
  });
  const result = await scheduleMeeting({ message: "" }, data);
  expect(result.message).toContain("Chưa lưu lịch");
  expect(result.message).toContain("chưa cập nhật");
  expect(result.message).not.toContain("public.schedule_meeting");
  expect(revalidatePath).not.toHaveBeenCalled();
});

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
  for (const path of ["/sessions", "/", "/debts", "/notifications"])
    expect(revalidatePath).toHaveBeenCalledWith(path);
});

it("explains missing bank information without claiming a session was saved", async () => {
  const data = form();
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { message: "Người tính tiền cần ngân hàng" },
  });
  const result = await createSession({ message: "" }, data);
  expect(result.message).toContain("Chưa lưu buổi");
  expect(result.message).toContain("Hồ sơ");
  expect(revalidatePath).not.toHaveBeenCalled();
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
