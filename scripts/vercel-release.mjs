import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";
import { validateRelease, waitForDomain } from "./release-utils.mjs";

delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
const mode = process.argv[2];
try {
  const cli = process.env.VERCEL_CLI_PATH;
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const orgId = process.env.VERCEL_ORG_ID;
  const commit = process.env.GITHUB_SHA;
  if (
    !cli ||
    !existsSync(cli) ||
    !token ||
    !/^prj_[a-zA-Z0-9]+$/.test(projectId || "") ||
    !/^team_[a-zA-Z0-9]+$/.test(orgId || "") ||
    !/^[a-f0-9]{40}$/.test(commit || "")
  )
    throw Object.assign(new Error(), { code: "RELEASE_CONFIGURATION_MISSING" });
  function vercel(args) {
    // Capture CLI output; never echo credentials or raw deployment metadata.
    const output = execFileSync(
      process.execPath,
      [cli, ...args, "--token", token],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, SUPABASE_DB_URL: "" },
      },
    );
    return JSON.parse(output);
  }
  const expected = { projectId, orgId, commit };
  const inspect = (id) =>
    vercel(["api", `/v13/deployments/${id}?teamId=${orgId}`, "--raw"]);
  if (mode === "prepare") {
    mkdirSync(".vercel", { recursive: true });
    writeFileSync(".vercel/project.json", JSON.stringify({ projectId, orgId }));
    const result = vercel([
      "deploy",
      "--prod",
      "--skip-domain",
      "--yes",
      "--json",
      "--meta",
      "sourceCommit=" + commit,
    ]);
    const id = result.deployment?.id;
    if (!/^dpl_[a-zA-Z0-9]+$/.test(id || ""))
      throw Object.assign(new Error(), { code: "DEPLOYMENT_NOT_CREATED" });
    const release = validateRelease(inspect(id), expected);
    writeFileSync(".vercel/release.json", JSON.stringify(release));
    console.log(
      JSON.stringify({ prepared: release.id, state: "READY", source: commit }),
    );
  } else if (mode === "promote") {
    const stored = JSON.parse(readFileSync(".vercel/release.json", "utf8"));
    if (
      stored.commit !== commit ||
      stored.projectId !== projectId ||
      stored.orgId !== orgId ||
      !/^dpl_[a-zA-Z0-9]+$/.test(stored.id)
    )
      throw Object.assign(new Error(), { code: "RELEASE_REFERENCE_MISMATCH" });
    const release = validateRelease(inspect(stored.id), expected);
    const origin = new URL(process.env.PRODUCTION_APP_URL);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      throw Object.assign(new Error(), { code: "INVALID_PRODUCTION_ORIGIN" });
    const promoted = vercel(["promote", release.id, "--yes", "--json"]);
    if (promoted.outcome !== "promoted")
      throw Object.assign(new Error(), { code: "PROMOTION_FAILED" });
    await waitForDomain(
      () => vercel(["inspect", origin.origin, "--json"]),
      release.id,
      {
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      },
    );
    for (const path of ["/login", "/manifest.webmanifest"]) {
      const response = await fetch(new URL(path, origin), {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      await response.body?.cancel();
      if (response.status !== 200)
        throw Object.assign(new Error(), {
          code: "PRODUCTION_HTTP_SMOKE_FAILED",
        });
    }
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Released commit \`${commit}\` to ${origin.origin} (${release.id}). Migration and schema checks passed.\n`,
      );
    console.log(
      JSON.stringify({
        promoted: release.id,
        domain: origin.origin,
        source: commit,
        httpSmoke: true,
      }),
    );
  } else throw Object.assign(new Error(), { code: "UNKNOWN_RELEASE_COMMAND" });
} catch (error) {
  console.error(
    JSON.stringify({
      phase: mode,
      code: error.code || "VERCEL_RELEASE_FAILED",
      exit: error.status,
    }),
  );
  process.exitCode = 1;
}
