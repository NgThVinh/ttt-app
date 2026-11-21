"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
export default function LiveUpdates({ tables }: { tables: string[] }) {
  const router = useRouter();
  const key = tables.join(",");
  useEffect(() => {
    const db = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 300);
    };
    let channel = db.channel("updates:" + key);
    for (const table of key.split(","))
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        refresh,
      );
    channel.subscribe();
    const focus = () => {
      if (!document.hidden) refresh();
    };
    const fallback = setInterval(focus, 30000);
    window.addEventListener("focus", focus);
    return () => {
      clearTimeout(timer);
      clearInterval(fallback);
      window.removeEventListener("focus", focus);
      void db.removeChannel(channel);
    };
  }, [key, router]);
  return null;
}
