import { it, expect } from "vitest";
import { databaseUrlForProject } from "../../scripts/migration-utils.mjs";
const api = "https://exampleproject.supabase.co";
it("allows the matching direct host and pooler identity", () => {
  expect(
    databaseUrlForProject(
      "postgresql://postgres:secret@db.exampleproject.supabase.co:5432/postgres",
      api,
    ),
  ).toContain("db.exampleproject.supabase.co");
  expect(
    databaseUrlForProject(
      "postgresql://postgres.exampleproject:secret@aws-0-region.pooler.supabase.com:5432/postgres",
      api,
    ),
  ).toContain("postgres.exampleproject");
});
it("rejects mismatched projects, foreign hosts and databases", () => {
  for (const url of [
    "postgresql://postgres:secret@db.other.supabase.co/postgres",
    "postgresql://postgres.other:secret@aws-0-region.pooler.supabase.com/postgres",
    "postgresql://postgres.exampleproject:secret@evil.test/postgres",
    "postgresql://postgres:secret@db.exampleproject.supabase.co/template1",
  ])
    expect(() => databaseUrlForProject(url, api)).toThrow();
});
it("strips connection-string SSL overrides so explicit verified TLS controls the client", () => {
  const u = new URL(
    databaseUrlForProject(
      "postgresql://postgres:secret@db.exampleproject.supabase.co/postgres?sslmode=disable&sslrootcert=untrusted",
      api,
    ),
  );
  expect(u.searchParams.has("sslmode")).toBe(false);
  expect(u.searchParams.has("sslrootcert")).toBe(false);
});
