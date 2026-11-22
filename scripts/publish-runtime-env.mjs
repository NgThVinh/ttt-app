import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
const linked = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
if (linked.projectId !== "prj_SHWPKZTF6Sdb0q3yG4d7OT1uathG")
  throw Error("WRONG_PROJECT");
const names = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPER_ADMIN_EMAILS",
  "AI_KEY_ENCRYPTION_SECRET",
  "CRON_SECRET",
];
const optional = [
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "AI_ALLOWED_COMPATIBLE_HOSTS",
  "NEXT_PUBLIC_VIETQR_TEMPLATE",
];
for (const name of names)
  if (!process.env[name]) throw Error("MISSING_" + name);
const values = Object.fromEntries(
  [...names, ...optional.filter((name) => process.env[name])].map((name) => [
    name,
    process.env[name],
  ]),
);
values.NEXT_PUBLIC_APP_URL = "https://thichtinhtien.online";
values.NEXT_PUBLIC_APP_NAME = "3T";
values.AI_KILL_SWITCH = "1";
for (const [name, value] of Object.entries(values)) {
  try {
    execFileSync(
      process.execPath,
      [
        ".tools/vercel/node_modules/vercel/dist/vc.js",
        "env",
        "add",
        name,
        "--environment",
        "production",
        "--force",
        name.startsWith("NEXT_PUBLIC_") ? "--no-sensitive" : "--sensitive",
        "--yes",
      ],
      {
        input: value,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      },
    );
    console.log(
      JSON.stringify({ configured: name, environment: "production" }),
    );
  } catch {
    console.error(JSON.stringify({ failed: name }));
    process.exit(1);
  }
}
