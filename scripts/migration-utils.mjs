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
