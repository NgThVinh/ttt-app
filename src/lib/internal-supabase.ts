import "server-only";
import { createClient } from "@supabase/supabase-js";
/** Internal workers and credential vault only. Never pass this client to business tools. */
export function internalSupabase() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw Error("Internal credentials unavailable");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
