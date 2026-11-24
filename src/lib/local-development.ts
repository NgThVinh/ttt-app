import "server-only";
import { allowsLocalLogin } from "./local-development-config.mjs";

export function localDevelopmentEnabled() {
  return allowsLocalLogin({
    nodeEnv: process.env.NODE_ENV,
    flag: process.env.THREE_T_LOCAL_DEVELOPMENT,
    apiUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    vercel: process.env.VERCEL,
  });
}
