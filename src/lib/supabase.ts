import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
// React cache is scoped to one server render, never shared between users/requests.
export const supabase = cache(async () => {
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          try {
            values.forEach(({ name, value, options }) =>
              jar.set(name, value, options),
            );
          } catch {
            /* Server components cannot set cookies. */
          }
        },
      },
    },
  );
});
export const currentUser = cache(async () => {
  const db = await supabase();
  return (await db.auth.getUser()).data.user;
});
