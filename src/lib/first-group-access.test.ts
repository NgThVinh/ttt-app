import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "test-user" } } }),
      getUser: mock.user,
    },
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        limit: async () => ({ data: [], error: null }),
      };
      return query;
    },
    rpc: mock.rpc,
  }),
}));
import { proxy } from "@/proxy";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function setup(
  email = "admin@example.com",
  confirmed = true,
  dbAllowed = true,
) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test");
  vi.stubEnv("SUPER_ADMIN_EMAILS", "admin@example.com");
  mock.user.mockResolvedValue({
    data: {
      user: { email, email_confirmed_at: confirmed ? "2026-11-23" : null },
    },
  });
  mock.rpc.mockResolvedValue({ data: dbAllowed, error: null });
}
it("lets a verified dual-allowlisted super admin open and submit first-group creation", async () => {
  setup();
  for (const method of ["GET", "POST"]) {
    const response = await proxy(
      new NextRequest("http://localhost:3000/groups", { method }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBe(null);
  }
  expect(
    (await proxy(new NextRequest("http://localhost:3000/"))).headers.get(
      "location",
    ),
  ).toBe("http://localhost:3000/groups");
  expect(
    (
      await proxy(new NextRequest("http://localhost:3000/sessions"))
    ).headers.get("location"),
  ).toBe("http://localhost:3000/welcome");
});
it.each([
  ["other@example.com", true, true],
  ["admin@example.com", false, true],
  ["admin@example.com", true, false],
])(
  "keeps ordinary/unverified/single-allowlist accounts locked: %s",
  async (email, confirmed, dbAllowed) => {
    setup(email, confirmed, dbAllowed);
    expect(
      (
        await proxy(new NextRequest("http://localhost:3000/groups"))
      ).headers.get("location"),
    ).toBe("http://localhost:3000/welcome");
    expect(
      (
        await proxy(
          new NextRequest("http://localhost:3000/groups", { method: "POST" }),
        )
      ).status,
    ).toBe(403);
  },
);
