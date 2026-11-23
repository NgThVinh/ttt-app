import type { supabase } from "./supabase";
import { envAllowsSuperAdmin } from "./super-admin-config.mjs";
/** Only a verified user and both allowlists can bootstrap the first group. */
export async function verifiedSuperAdmin(
  db: Awaited<ReturnType<typeof supabase>>,
) {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (
    !user ||
    !envAllowsSuperAdmin(
      user.email,
      user.email_confirmed_at,
      process.env.SUPER_ADMIN_EMAILS,
    )
  )
    return false;
  const result = await db.rpc("is_super_admin");
  return !result.error && result.data === true;
}
