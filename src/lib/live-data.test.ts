import { afterEach, beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  channels: [] as {
    handlers: Map<string, (payload: { eventType: string }) => void>;
    status?: (value: string) => void;
  }[],
  remove: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    channel: () => {
      const channel = {
        handlers: new Map<string, (payload: { eventType: string }) => void>(),
        status: undefined as ((value: string) => void) | undefined,
        on: (
          _: string,
          filter: { table: string },
          callback: (payload: { eventType: string }) => void,
        ) => {
          channel.handlers.set(filter.table, callback);
          return channel;
        },
        subscribe: (callback: (value: string) => void) => {
          channel.status = callback;
          return channel;
        },
      };
      transport.channels.push(channel);
      return channel;
    },
    removeChannel: transport.remove,
  }),
}));
let doc: EventTarget & { hidden: boolean };
let nav: { onLine: boolean };
let cleanup: (() => void)[];
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  transport.channels.length = 0;
  transport.remove.mockClear();
  cleanup = [];
  doc = Object.assign(new EventTarget(), { hidden: false });
  nav = { onLine: true };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", nav);
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  for (const stop of cleanup) stop();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("shares a single channel, deduplicates table subscriptions and routes events", async () => {
  const { subscribeToChanges } = await import("./live-data");
  const first = vi.fn(),
    second = vi.fn(),
    page = vi.fn();
  cleanup.push(subscribeToChanges(["notifications"], first));
  cleanup.push(subscribeToChanges(["notifications"], second));
  cleanup.push(subscribeToChanges(["sessions"], page));
  vi.advanceTimersByTime(1);
  expect(transport.channels).toHaveLength(1);
  const ch = transport.channels[0];
  expect([...ch.handlers.keys()]).toEqual(["notifications", "sessions"]);
  ch.status?.("SUBSCRIBED");
  ch.handlers.get("notifications")?.({ eventType: "INSERT" });
  vi.advanceTimersByTime(5_000);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  expect(page).not.toHaveBeenCalled();
});
it("removes the socket while hidden or offline and reconnects with one catch-up", async () => {
  const { subscribeToChanges } = await import("./live-data");
  const refresh = vi.fn();
  cleanup.push(subscribeToChanges(["sessions"], refresh));
  vi.advanceTimersByTime(1);
  const initial = transport.channels[0];
  initial.status?.("SUBSCRIBED");
  doc.hidden = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(transport.remove).toHaveBeenCalledTimes(1);
  initial.handlers.get("sessions")?.({ eventType: "UPDATE" });
  vi.advanceTimersByTime(600_000);
  expect(refresh).not.toHaveBeenCalled();
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(transport.channels).toHaveLength(2);
  transport.channels[1].status?.("SUBSCRIBED");
  vi.advanceTimersByTime(750);
  expect(refresh).toHaveBeenCalledTimes(1);
  nav.onLine = false;
  window.dispatchEvent(new Event("offline"));
  vi.advanceTimersByTime(600_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  nav.onLine = true;
  window.dispatchEvent(new Event("online"));
  transport.channels[2].status?.("SUBSCRIBED");
  vi.advanceTimersByTime(750);
  expect(refresh).toHaveBeenCalledTimes(2);
});
it("catches up after an interrupted socket, without repeated healthy-idle requests", async () => {
  const { subscribeToChanges } = await import("./live-data");
  const refresh = vi.fn();
  cleanup.push(subscribeToChanges(["sessions"], refresh));
  vi.advanceTimersByTime(1);
  const ch = transport.channels[0];
  ch.status?.("SUBSCRIBED");
  vi.advanceTimersByTime(600_000);
  expect(refresh).not.toHaveBeenCalled();
  ch.status?.("CHANNEL_ERROR");
  ch.status?.("SUBSCRIBED");
  vi.advanceTimersByTime(750);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("updates the notification badge on reads without refetching calendar data", async () => {
  const { subscribeToChanges } = await import("./live-data");
  const badge = vi.fn(),
    calendar = vi.fn();
  cleanup.push(subscribeToChanges(["notifications"], badge));
  cleanup.push(
    subscribeToChanges(["sessions", "notifications"], calendar, {
      notificationInsertsOnly: true,
    }),
  );
  vi.advanceTimersByTime(1);
  const ch = transport.channels[0];
  ch.status?.("SUBSCRIBED");
  ch.handlers.get("notifications")?.({ eventType: "UPDATE" });
  vi.advanceTimersByTime(5_000);
  expect(badge).toHaveBeenCalledTimes(1);
  expect(calendar).not.toHaveBeenCalled();
  ch.handlers.get("notifications")?.({ eventType: "INSERT" });
  vi.advanceTimersByTime(5_000);
  expect(calendar).toHaveBeenCalledTimes(1);
});
