import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ exchange: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: async () => ({ auth: { exchangeCodeForSession: mocks.exchange } }),
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
  mocks.exchange.mockResolvedValue({ error: { message: "expired" } });
  for (const query of ["?code=expired", ""])
    expect(
      (
        await GET(
          new NextRequest("https://internal.example/auth/callback" + query),
        )
      ).headers.get("location"),
    ).toBe("https://thichtinhtien.online/login?error=1");
});
