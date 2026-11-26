"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { subscribeToChanges } from "@/lib/live-data";
export default function LiveUpdates({ tables }: { tables: string[] }) {
  const router = useRouter();
  const key = tables.join(",");
  useEffect(() => {
    return subscribeToChanges(key.split(","), () => router.refresh(), {
      // New notifications cover soft deletion, whose updated row is hidden by RLS.
      // Reading a notification should not reload the home/calendar data.
      notificationInsertsOnly: key.includes("sessions"),
    });
  }, [key, router]);
  return null;
}
