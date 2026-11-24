import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  signIn: vi.fn(),
  headers: vi.fn(),
  membership: vi.fn(),
}));
vi.mock("@/lib/local-development", () => ({
  localDevelopmentEnabled: mocks.enabled,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: async () => ({
    auth: { signInWithPassword: mocks.signIn },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ limit: mocks.membership }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/super-admin-access", () => ({
  verifiedSuperAdmin: async () => false,
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Error("not-found");
  },
  redirect: (url: string) => {
    throw Error("redirect:" + url);
  },
}));
import { localLogin } from "@/app/local-actions";
function form(account = "an") {
  mocks.enabled.mockReturnValue(true);
  mocks.signIn.mockResolvedValue({
    data: { user: { id: "local-user" } },
    error: null,
  });
  mocks.membership.mockResolvedValue({
    data: [{ id: "membership" }],
    error: null,
  });
  mocks.headers.mockResolvedValue(
    new Headers({ host: "localhost:3000", origin: "http://localhost:3000" }),
  );
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("THREE_T_LOCAL_AUTH_PASSWORD", "test-password-only-in-memory");
  const form = new FormData();
  form.set("account", account);
  return form;
}
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
it("uses real Auth with a server-only password and ignores a password supplied by the browser", async () => {
  const data = form();
  data.set("password", "attacker");
  data.set("next", "https://evil.test");
  await expect(localLogin(data)).rejects.toThrow("redirect:/");
  expect(mocks.signIn).toHaveBeenCalledWith({
    email: "an@local.3t.test",
    password: "test-password-only-in-memory",
  });
});
it("does not contact Auth when local mode is disabled, even for a valid seeded account", async () => {
  const data = form();
  mocks.enabled.mockReturnValue(false);
  await expect(localLogin(data)).rejects.toThrow("not-found");
  expect(mocks.signIn).not.toHaveBeenCalled();
});
it("routes an uninvited local user directly to welcome instead of reusing a previous member's page", async () => {
  const data = form("guest");
  mocks.membership.mockResolvedValue({ data: [], error: null });
  await expect(localLogin(data)).rejects.toThrow("redirect:/welcome");
});
it("does not contact Auth for a remote origin or an arbitrary account", async () => {
  const data = form();
  mocks.headers.mockResolvedValue(
    new Headers({ host: "localhost:3000", origin: "https://evil.test" }),
  );
  await expect(localLogin(data)).rejects.toThrow("not-found");
  expect(mocks.signIn).not.toHaveBeenCalled();
  const unknown = form("someone@example.com");
  await expect(localLogin(unknown)).rejects.toThrow("redirect:/login?error=1");
  expect(mocks.signIn).not.toHaveBeenCalled();
});
