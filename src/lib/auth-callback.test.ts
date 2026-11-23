import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ exchange: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: async () => ({
    auth: { exchangeCodeForSession: mocks.exchange, getUser: mocks.user },
  }),
}));
import { GET } from "@/app/auth/callback/route";
import { proxy } from "@/proxy";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("routes a root OAuth code to exchange before the anonymous gate", async () => {
  const response = await proxy(
    new NextRequest(
      "https://thichtinhtien.online/?code=synthetic&next=%2Fjoin%2F" +
        "a".repeat(64),
    ),
  );
  expect(response.headers.get("location")).toBe(
    "https://thichtinhtien.online/auth/callback?code=synthetic&next=%2Fjoin%2F" +
      "a".repeat(64),
  );
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it("exchanges the code and returns to a validated invitation at the configured origin", async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://thichtinhtien.online");
  mocks.exchange.mockResolvedValue({ error: null });
  const response = await GET(
    new NextRequest(
      "https://internal.example/auth/callback?code=synthetic&next=" +
        encodeURIComponent("/join/" + "b".repeat(64)),
    ),
  );
  expect(mocks.exchange).toHaveBeenCalledWith("synthetic");
  expect(mocks.user).not.toHaveBeenCalled();
  expect(response.headers.get("location")).toBe(
    "https://thichtinhtien.online/join/" + "b".repeat(64),
  );
});
it("rejects arbitrary return URLs and handles expired/missing codes", async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://thichtinhtien.online");
  mocks.exchange.mockResolvedValue({ error: null });
  expect(
    (
      await GET(
        new NextRequest(
          "https://internal.example/auth/callback?code=synthetic&next=https://evil.example",
        ),
      )
    ).headers.get("location"),
  ).toBe("https://thichtinhtien.online/");
  mocks.exchange.mockResolvedValue({ error: { code: "flow_state_expired" } });
  mocks.user.mockResolvedValue({ data: { user: null }, error: null });
  for (const query of ["?code=expired", ""])
    expect(
      (
        await GET(
          new NextRequest("https://internal.example/auth/callback" + query),
        )
      ).headers.get("location"),
    ).toBe(
      `https://thichtinhtien.online/login?error=${query ? "expired_link" : "sign_in_failed"}`,
    );
});

it("recovers a root OAuth error without losing a validated invite or leaking the provider description", async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  mocks.user.mockResolvedValue({ data: { user: null }, error: null });
  const invite = "/join/" + "c".repeat(64);
  const response = await proxy(
    new NextRequest(
      "http://localhost:3000/?error=invalid_request&error_code=flow_state_already_used&error_description=private-detail&next=" +
        encodeURIComponent(invite),
    ),
  );
  const callback = await GET(
    new NextRequest(response.headers.get("location")!),
  );
  const location = new URL(callback.headers.get("location")!);
  expect(location.origin).toBe("http://localhost:3000");
  expect(location.pathname).toBe("/login");
  expect(location.searchParams.get("error")).toBe("used_link");
  expect(location.searchParams.get("next")).toBe(invite);
  expect(location.href).not.toContain("private-detail");
  expect(callback.headers.get("cache-control")).toContain("no-store");
  expect(mocks.exchange).not.toHaveBeenCalled();
});

it("uses an Auth-verified session after a duplicate callback rather than exchanging twice", async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://thichtinhtien.online");
  mocks.exchange.mockResolvedValue({ error: { code: "flow_state_not_found" } });
  mocks.user.mockResolvedValue({
    data: { user: { id: "current-user" } },
    error: null,
  });
  const request = new NextRequest(
    "https://thichtinhtien.online/auth/callback?code=used",
  );
  const response = await GET(request);
  expect(response.headers.get("location")).toBe(
    "https://thichtinhtien.online/",
  );
  expect(mocks.exchange).toHaveBeenCalledTimes(1);
  expect(mocks.user).toHaveBeenCalledTimes(1);
});

it("does not accept identity returned alongside an Auth verification error", async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://thichtinhtien.online");
  mocks.user.mockResolvedValue({
    data: { user: { id: "unverified" } },
    error: { code: "bad_jwt" },
  });
  const response = await GET(
    new NextRequest(
      "https://thichtinhtien.online/auth/callback?error=access_denied&next=https://evil.example",
    ),
  );
  expect(response.headers.get("location")).toBe(
    "https://thichtinhtien.online/login?error=cancelled",
  );
});
