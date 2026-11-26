import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
// Compare actual private values locally; errors expose variable names, never values.
const sources = [
  process.env,
  ...[".env", ".env.local", ".env.development.local"]
    .filter(existsSync)
    .map((file) => parseEnv(readFileSync(file, "utf8"))),
];
const names = [
  "SUPABASE_DB_URL",
  "SUPABASE_CI_DB_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AI_KEY_ENCRYPTION_SECRET",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "CRON_SECRET",
  "VAPID_PRIVATE_KEY",
  "VERCEL_TOKEN",
  "SUPABASE_ACCESS_TOKEN",
  "GOOGLE_CLIENT_SECRET",
  "THREE_T_LOCAL_AUTH_PASSWORD",
];
const secrets = sources.flatMap((source) =>
  names.flatMap((name) =>
    source[name]?.length >= 12
      ? [{ name, bytes: Buffer.from(source[name]) }]
      : [],
  ),
);
const files = execFileSync(
  "git",
  [
    "-c",
    `safe.directory=${process.cwd().replaceAll("\\", "/")}`,
    "ls-files",
    "-z",
  ],
  { encoding: "utf8", windowsHide: true },
)
  .split("\0")
  .filter(Boolean);
const failures = [];
const knownPrivateCredential =
  /sk-or-v1-[a-f0-9]{64}|AIza[0-9A-Za-z_-]{35}|sb_secret_[a-zA-Z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
for (const file of files) {
  if (
    /^(?:\.env(?:$|\.(?!example$))|\.secrets\/|\.vercel\/|\.tools\/)/.test(file)
  )
    failures.push({ file, reason: "PRIVATE_FILE_TRACKED" });
  if (!existsSync(file)) continue;
  const value = readFileSync(file);
  if (knownPrivateCredential.test(value.toString("utf8")))
    failures.push({ file, reason: "PRIVATE_CREDENTIAL_PATTERN" });
  for (const secret of secrets)
    if (value.includes(secret.bytes))
      failures.push({ file, reason: "PRIVATE_VALUE", variable: secret.name });
}
let bundles = 0;
function scanClient(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) scanClient(path);
    else if (/\.(?:js|map)$/.test(entry.name)) {
      bundles++;
      const value = readFileSync(path);
      for (const secret of secrets)
        if (value.includes(secret.bytes))
          failures.push({
            file: path,
            reason: "PRIVATE_VALUE_IN_CLIENT",
            variable: secret.name,
          });
    }
  }
}
scanClient(".next/static");
scanClient(".next/dev/static");
console.log(
  JSON.stringify({
    passed: failures.length === 0,
    trackedFiles: files.length,
    clientBundles: bundles,
    privateValuesChecked: secrets.length,
    failures,
  }),
);
if (failures.length) process.exitCode = 1;
