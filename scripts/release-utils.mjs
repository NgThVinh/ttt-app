export function validateRelease(deployment, expected) {
  if (
    !/^dpl_[a-zA-Z0-9]+$/.test(deployment.id || "") ||
    deployment.projectId !== expected.projectId ||
    deployment.readyState !== "READY" ||
    deployment.target !== "production" ||
    deployment.meta?.sourceCommit !== expected.commit
  )
    throw Object.assign(new Error(), { code: "UNEXPECTED_DEPLOYMENT" });
  const url = new URL("https://" + deployment.url);
  if (
    !url.hostname.endsWith(".vercel.app") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Object.assign(new Error(), { code: "INVALID_DEPLOYMENT_URL" });
  return { id: deployment.id, url: url.origin, ...expected };
}

/**
 * @param {() => Promise<{id: string, readyState: string}>} inspect
 * @param {string} id
 * @param {{sleep: (milliseconds: number) => Promise<void>, attempts?: number}} options
 */
export async function waitForDomain(inspect, id, { sleep, attempts = 20 }) {
  for (let n = 0; n < attempts; n++) {
    const current = await inspect();
    if (current.id === id && current.readyState === "READY") return;
    if (n < attempts - 1) await sleep(3000);
  }
  throw Object.assign(new Error(), { code: "DOMAIN_RELEASE_MISMATCH" });
}
