import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
loadEnvFile(".env");
const env = { ...process.env, AI_PROVIDER_EVAL: "1" };
delete env.NODE_TLS_REJECT_UNAUTHORIZED;
const child = spawn(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "src/lib/ai/provider-eval.test.ts"],
  { env, stdio: "inherit" },
);
child.on("error", () => {
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
