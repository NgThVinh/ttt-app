import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRefreshController } from "./refresh-controller";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-27T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

it("does no periodic page fetch for a healthy idle connection", () => {
  const refresh = vi.fn();
  const c = createRefreshController(refresh);
  c.connection(true);
  vi.advanceTimersByTime(60 * 60_000);
  expect(refresh).not.toHaveBeenCalled();
  c.dispose();
});
it("bounds a continuous change storm and never postpones changes forever", () => {
  const refresh = vi.fn();
  const c = createRefreshController(refresh);
  c.connection(true);
  for (let i = 0; i < 600; i++) {
    c.event();
    vi.advanceTimersByTime(100);
  }
  expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(11);
  expect(refresh.mock.calls.length).toBeLessThanOrEqual(12);
  c.dispose();
});
it("suspends pending changes and fallback while hidden/offline, catches up on return", () => {
  const refresh = vi.fn();
  const c = createRefreshController(refresh);
  c.event();
  c.active(false);
  vi.advanceTimersByTime(10 * 60_000);
  c.event();
  c.resume();
  expect(refresh).not.toHaveBeenCalled();
  c.active(true);
  vi.advanceTimersByTime(750);
  expect(refresh).toHaveBeenCalledTimes(1);
  c.dispose();
});
it("uses a two-minute fallback during failure, even with repeated error statuses", () => {
  const refresh = vi.fn();
  const c = createRefreshController(refresh);
  for (let i = 0; i < 7; i++) {
    c.connection(false);
    vi.advanceTimersByTime(30_000);
  }
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30_001);
  expect(refresh).toHaveBeenCalledTimes(2);
  c.connection(true);
  vi.advanceTimersByTime(10 * 60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  c.dispose();
});
it("starts fallback when a healthy socket fails, and coalesces repeated focus events", () => {
  const refresh = vi.fn();
  const c = createRefreshController(refresh);
  c.connection(true);
  for (let i = 0; i < 10; i++) {
    c.resume();
    vi.advanceTimersByTime(1_000);
  }
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(20_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  c.connection(false);
  vi.advanceTimersByTime(120_001);
  expect(refresh).toHaveBeenCalledTimes(2);
  c.dispose();
});
it("cancels all callbacks when a view unmounts", () => {
  const refresh = vi.fn();
  const c = createRefreshController(refresh);
  c.event();
  c.dispose();
  vi.advanceTimersByTime(60 * 60_000);
  c.resume();
  c.active(true);
  c.connection(false);
  expect(refresh).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
