import { expect, it } from "vitest";
import {
  allowsLocalLogin,
  allowsLocalRequest,
} from "./local-development-config.mjs";
const local = {
  nodeEnv: "development",
  flag: "1",
  apiUrl: "http://127.0.0.1:54321",
  appUrl: "http://localhost:3000",
  vercel: undefined,
};
it("enables local account login only for explicit development with loopback endpoints", () => {
  expect(allowsLocalLogin(local)).toBe(true);
  for (const patch of [
    { nodeEnv: "production" },
    { nodeEnv: "test" },
    { flag: "0" },
    { flag: undefined },
    { apiUrl: "https://project.supabase.co" },
    { appUrl: "https://thichtinhtien.online" },
    { apiUrl: "http://127.0.0.1.evil.test:54321" },
    { vercel: "1" },
  ])
    expect(allowsLocalLogin({ ...local, ...patch })).toBe(false);
});
it("requires the local request host and same origin, not a forwarded or external origin", () => {
  expect(
    allowsLocalRequest("localhost:3000", "http://localhost:3000", local.appUrl),
  ).toBe(true);
  expect(
    allowsLocalRequest("127.0.0.1:3000", "http://127.0.0.1:3000", local.appUrl),
  ).toBe(true);
  for (const [host, origin] of [
    ["thichtinhtien.online", "https://thichtinhtien.online"],
    ["localhost:3000", "https://evil.test"],
    ["localhost:3001", "http://localhost:3001"],
    ["localhost:3000", "http://127.0.0.1:3000"],
  ])
    expect(allowsLocalRequest(host, origin, local.appUrl)).toBe(false);
  expect(
    allowsLocalRequest("localhost:3000", null, "https://thichtinhtien.online"),
  ).toBe(false);
});
