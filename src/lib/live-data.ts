"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createRefreshController } from "./refresh-controller";

type Listener = {
  tables: Set<string>;
  controller: ReturnType<typeof createRefreshController>;
  notificationInsertsOnly: boolean;
};
const listeners = new Set<Listener>();
let channel: RealtimeChannel | undefined;
let channelKey = "";
let connected = false;
let update: ReturnType<typeof setTimeout> | undefined;
const browserDb = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
const active = () => !document.hidden && navigator.onLine;

function sync() {
  const visible = active();
  for (const listener of listeners) listener.controller.active(visible);
  const tables = [
    ...new Set([...listeners].flatMap((l) => [...l.tables])),
  ].sort();
  const key = visible ? tables.join(",") : "";
  if (key === channelKey) return;
  const previous = channel;
  channel = undefined;
  channelKey = key;
  connected = false;
  for (const listener of listeners) listener.controller.connection(false);
  if (previous) void browserDb().removeChannel(previous);
  if (!key) return;
  const next = browserDb().channel("3t-visible-updates:" + key);
  channel = next;
  for (const table of tables)
    next.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      (payload) => {
        if (channel !== next || !active()) return;
        for (const listener of listeners)
          if (
            listener.tables.has(table) &&
            !(
              table === "notifications" &&
              listener.notificationInsertsOnly &&
              payload.eventType !== "INSERT"
            )
          )
            listener.controller.event();
      },
    );
  let wasDisconnected = false;
  next.subscribe((status) => {
    if (channel !== next) return;
    const wasConnected = connected;
    connected = status === "SUBSCRIBED";
    for (const listener of listeners) {
      listener.controller.connection(connected);
      // Reconnection can miss changes. Initial subscriptions already have server data.
      if (connected && wasDisconnected) listener.controller.resume();
    }
    if (wasConnected && !connected) wasDisconnected = true;
  });
}
function queueSync() {
  clearTimeout(update);
  update = setTimeout(sync, 0);
}
function resume() {
  sync();
  if (active()) for (const listener of listeners) listener.controller.resume();
}

// A single transport per tab, shared by the page and notification badge.
// No user data is persisted, and all channels are removed when the last view leaves.
export function subscribeToChanges(
  tables: string[],
  refresh: () => void,
  options: { notificationInsertsOnly?: boolean } = {},
) {
  const listener = {
    tables: new Set(tables),
    controller: createRefreshController(refresh),
    notificationInsertsOnly: options.notificationInsertsOnly === true,
  };
  if (!listeners.size) {
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);
  }
  listeners.add(listener);
  listener.controller.active(active());
  listener.controller.connection(connected);
  queueSync();
  return () => {
    listener.controller.dispose();
    listeners.delete(listener);
    if (!listeners.size) {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
    }
    queueSync();
  };
}
