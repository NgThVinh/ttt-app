import { createHash } from "node:crypto";

export function migrationContent(input) {
  const sql = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const digest = (text) => createHash("sha256").update(text).digest("hex");
  return {
    sql,
    hash: digest(sql),
    originalHash: digest(input.replace(/^\uFEFF/, "")),
    windowsHash: digest(sql.replace(/\n/g, "\r\n")),
  };
}

export function migrationPlan(local, history, checksums) {
  const files = new Map(local.map((m) => [m.version, m]));
  if (files.size !== local.length)
    throw Object.assign(new Error(), { code: "DUPLICATE_VERSION" });
  if (history.some((h) => !files.has(h.version)))
    throw Object.assign(new Error(), { code: "UNKNOWN_REMOTE_HISTORY" });
  const canonicalize = [];
  for (const row of checksums) {
    const file = files.get(row.version);
    const stored = history.find((h) => h.version === row.version)?.statements;
    const previous = stored?.length === 1 ? migrationContent(stored[0]) : null;
    const sameLegacySql =
      previous &&
      previous.originalHash === row.sha256 &&
      previous.hash === file?.hash;
    if (
      !file ||
      !([file.hash, file.windowsHash].includes(row.sha256) || sameLegacySql)
    )
      throw Object.assign(new Error(), { code: "APPLIED_MIGRATION_CHANGED" });
    if (row.sha256 !== file.hash) canonicalize.push(file);
  }
  const applied = new Set(history.map((h) => h.version));
  const pending = local.filter((m) => !applied.has(m.version));
  const latest = [...applied].sort().at(-1);
  if (latest && pending.some((m) => m.version < latest))
    throw Object.assign(new Error(), { code: "OUT_OF_ORDER_MIGRATION" });
  return { pending, canonicalize };
}

/** Match the database to the configured hosted API before any SQL is sent. */
export function databaseUrlForProject(databaseUrl, apiUrl) {
  const uri = new URL(databaseUrl);
  const api = new URL(apiUrl);
  const reference = api.hostname.split(".")[0];
  if (
    api.protocol !== "https:" ||
    !/^[a-z0-9]+\.supabase\.co$/.test(api.hostname)
  )
    throw Object.assign(new Error(), { code: "INVALID_API_URL" });
  if (
    !["postgresql:", "postgres:"].includes(uri.protocol) ||
    uri.pathname !== "/postgres"
  )
    throw Object.assign(new Error(), { code: "INVALID_DB_PROTOCOL_OR_NAME" });
  const direct = uri.hostname === `db.${reference}.supabase.co`;
  const pooler =
    uri.hostname.endsWith(".pooler.supabase.com") &&
    decodeURIComponent(uri.username) === `postgres.${reference}`;
  if (!direct && !pooler)
    throw Object.assign(new Error(), { code: "PROJECT_MISMATCH" });
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    uri.searchParams.delete(key);
  return uri.toString();
}
