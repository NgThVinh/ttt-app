import { beforeEach, afterEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  otp: vi.fn(),
  oauth: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: async () => ({
    auth: {
      signInWithOtp: mocks.otp,
      signInWithOAuth: mocks.oauth,
      signOut: mocks.signOut,
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("redirect"), { url });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { login, register, googleLogin, logout } from "./actions";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  mocks.otp.mockResolvedValue({ error: null });
  mocks.oauth.mockResolvedValue({
    data: { url: "https://accounts.google.com/test" },
    error: null,
  });
  mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());
const invite =
  "/join/" + "b".repeat(64) + "?session=00000000-0000-4000-8000-000000000001";
function form(next = invite) {
  const f = new FormData();
  f.set("email", "friend@example.com");
  f.set("next", next);
  return f;
}
it("email login never creates users; registration explicitly enables creation", async () => {
  await expect(login(form())).rejects.toMatchObject({
    url: expect.stringContaining("/login?sent=1"),
  });
  expect(mocks.otp.mock.calls[0][0].options.shouldCreateUser).toBe(false);
  await expect(register(form())).rejects.toMatchObject({
    url: expect.stringContaining("/register?sent=1"),
  });
  const options = mocks.otp.mock.calls[1][0].options;
  expect(options.shouldCreateUser).toBe(true);
  const url = new URL(options.emailRedirectTo);
  expect(url.origin).toBe("http://localhost:3000");
  expect(url.pathname).toBe("/auth/callback");
  expect(url.searchParams.get("next")).toBe(invite);
  expect(url.searchParams.get("mode")).toBe("register");
  expect(url.search.startsWith("?next=")).toBe(true);
});
it("unknown email gets the same login result and cannot leak account existence", async () => {
  mocks.otp.mockResolvedValue({ error: { code: "otp_disabled" } });
  await expect(login(form())).rejects.toMatchObject({
    url: "/login?sent=1&next=" + encodeURIComponent(invite),
  });
});
it("validation and external return URLs cannot send email or create an open redirect", async () => {
  const invalid = form();
  invalid.set("email", "invalid");
  await expect(register(invalid)).rejects.toMatchObject({
    url: expect.stringContaining("/register?error="),
  });
  expect(mocks.otp).not.toHaveBeenCalled();
  await expect(register(form("//evil.test"))).rejects.toMatchObject({
    url: "/register?sent=1&next=%2F",
  });
  expect(
    new URL(
      mocks.otp.mock.calls[0][0].options.emailRedirectTo,
    ).searchParams.get("next"),
  ).toBe("/");
});
it("Google sign up and account switching retain a valid invite on localhost", async () => {
  const f = form();
  f.set("mode", "register");
  await expect(googleLogin(f)).rejects.toMatchObject({
    url: "https://accounts.google.com/test",
  });
  const url = new URL(mocks.oauth.mock.calls[0][0].options.redirectTo);
  expect(url.origin).toBe("http://localhost:3000");
  expect(url.searchParams.get("next")).toBe(invite);
  expect(url.searchParams.get("mode")).toBe("register");
  await expect(logout(f)).rejects.toMatchObject({
    url: "/login?next=" + encodeURIComponent(invite),
  });
});
