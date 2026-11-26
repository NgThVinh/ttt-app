import { describe, expect, it, vi } from "vitest";
import {
  migrationContent,
  migrationPlan,
} from "../../scripts/migration-utils.mjs";
import {
  validateRelease,
  waitForDomain,
} from "../../scripts/release-utils.mjs";

describe("migration history in CI", () => {
  const first = { version: "001", ...migrationContent("select 1;\n") };
  const next = { version: "002", ...migrationContent("select 2;\n") };
  it("accepts Windows checksums on Linux without accepting SQL edits", () => {
    expect(migrationContent("\uFEFFselect 1;\r\n").hash).toBe(first.hash);
    expect(
      migrationPlan(
        [first, next],
        [{ version: "001" }],
        [{ version: "001", sha256: first.windowsHash }],
      ),
    ).toEqual({ pending: [next], canonicalize: [first] });
    expect(() =>
      migrationPlan(
        [{ ...first, ...migrationContent("select 100;\n") }],
        [{ version: "001" }],
        [{ version: "001", sha256: first.windowsHash }],
      ),
    ).toThrow();
  });
  it("does no work when all checksums are canonical and current", () => {
    expect(
      migrationPlan(
        [first],
        [{ version: "001" }],
        [{ version: "001", sha256: first.hash }],
      ),
    ).toEqual({ pending: [], canonicalize: [] });
  });
  it("proves mixed legacy line endings from stored SQL before canonicalizing", () => {
    const old = "select 1;\r\nselect 2;\n";
    const file = {
      version: "001",
      ...migrationContent(old.replace(/\r\n/g, "\n")),
    };
    const row = { version: "001", sha256: migrationContent(old).originalHash };
    expect(
      migrationPlan([file], [{ version: "001", statements: [old] }], [row])
        .canonicalize,
    ).toEqual([file]);
    expect(() =>
      migrationPlan(
        [file],
        [{ version: "001", statements: ["select 3;\n"] }],
        [row],
      ),
    ).toThrow();
    expect(() => migrationPlan([file], [{ version: "001" }], [row])).toThrow();
  });
  it("rejects duplicate, unknown and out-of-order migrations", () => {
    expect(() => migrationPlan([first, first], [], [])).toThrow();
    expect(() => migrationPlan([first], [{ version: "099" }], [])).toThrow();
    expect(() =>
      migrationPlan(
        [first, next],
        [{ version: "002" }],
        [{ version: "002", sha256: next.hash }],
      ),
    ).toThrow();
  });
});

describe("release gates", () => {
  const expected = {
    projectId: "prj_test",
    orgId: "team_test",
    commit: "a".repeat(40),
  };
  const deployment = {
    id: "dpl_test",
    projectId: expected.projectId,
    readyState: "READY",
    target: "production",
    meta: { sourceCommit: expected.commit },
    url: "3t-test.vercel.app",
  };
  it("pins the build to the intended project, commit and production environment", () => {
    expect(validateRelease(deployment, expected)).toMatchObject({
      id: "dpl_test",
      url: "https://3t-test.vercel.app",
      ...expected,
    });
    for (const patch of [
      { projectId: "prj_wrong" },
      { meta: { sourceCommit: "b".repeat(40) } },
      { readyState: "ERROR" },
      { target: "preview" },
      { url: "example.invalid" },
      { url: "3t-test.vercel.app/private" },
    ])
      expect(() =>
        validateRelease({ ...deployment, ...patch }, expected),
      ).toThrow();
  });
  it("waits for alias propagation before reporting success", async () => {
    const inspect = vi
      .fn()
      .mockResolvedValueOnce({ id: "dpl_old", readyState: "READY" })
      .mockResolvedValueOnce({ id: "dpl_test", readyState: "BUILDING" })
      .mockResolvedValue({ id: "dpl_test", readyState: "READY" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await waitForDomain(inspect, "dpl_test", { sleep, attempts: 3 });
    expect(inspect).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it("fails when promotion leaves the domain pointing at another build", async () => {
    await expect(
      waitForDomain(
        async () => ({ id: "dpl_old", readyState: "READY" }),
        "dpl_test",
        { sleep: async () => {}, attempts: 2 },
      ),
    ).rejects.toThrow();
  });
});
