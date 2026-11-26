import NextLink from "next/link";
import type { ComponentProps } from "react";

// Private pages query Supabase. Fetch them on navigation instead of speculatively
// running authentication and data queries for every visible link.
export default function AppLink(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
