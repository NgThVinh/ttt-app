import { z } from "zod";

/** Shared by server checks and the deployment sync CLI. Never print the input. */
export function parseSuperAdminEmails(raw, allowEmpty = false) {
  const input = raw || "";
  const emails = input.trim()
    ? input.split(",").map((value) => value.trim().toLowerCase())
    : [];
  const parsed = z.array(z.email().max(254)).max(50).safeParse(emails);
  if (!parsed.success || (!allowEmpty && emails.length === 0)) {
    throw Object.assign(new Error("Invalid super admin configuration"), {
      code: "INVALID_SUPER_ADMIN_EMAILS",
    });
  }
  return [...new Set(parsed.data)].sort();
}

export function envAllowsSuperAdmin(email, confirmedAt, raw) {
  if (!email || !confirmedAt) return false;
  try {
    return parseSuperAdminEmails(raw).includes(email.trim().toLowerCase());
  } catch {
    return false;
  }
}
