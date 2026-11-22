import { timingSafeEqual } from "node:crypto";
import * as webpush from "web-push";
import { z } from "zod";
import { internalSupabase } from "@/lib/internal-supabase";
import { safeAppPath, type NotificationChannel } from "@/lib/notifications";
export const runtime = "nodejs";
export const maxDuration = 60;
const rowSchema = z.object({
  id: z.uuid(),
  token: z.uuid(),
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  tag: z.uuid(),
  href: z.string(),
});
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") || "";
  const bytes = Buffer.from(supplied),
    match = Buffer.from(`Bearer ${expected}`);
  if (
    !expected ||
    bytes.length !== match.length ||
    !timingSafeEqual(bytes, match)
  )
    return new Response(null, { status: 401 });
  if (
    !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    !process.env.VAPID_PRIVATE_KEY ||
    !process.env.VAPID_SUBJECT
  )
    return Response.json({ ready: false }, { status: 503 });
  const db = internalSupabase();
  const { data, error } = await db.rpc("claim_push_deliveries");
  const rows = z.array(rowSchema).safeParse(data);
  if (error || !rows.success)
    return Response.json({ ready: false }, { status: 503 });
  const channel: NotificationChannel = {
    async deliver(subscription, payload) {
      const host = new URL(subscription.endpoint).hostname;
      if (
        ![
          "fcm.googleapis.com",
          "updates.push.services.mozilla.com",
          "web.push.apple.com",
        ].includes(host) &&
        !/^[a-z0-9-]+\.notify\.windows\.com$/.test(host)
      )
        return "expired";
      try {
        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: "3T · Có cập nhật mới",
            tag: payload.tag,
            href: safeAppPath(payload.href),
          }),
          {
            TTL: 3600,
            timeout: 5000,
            vapidDetails: {
              subject: process.env.VAPID_SUBJECT!,
              publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
              privateKey: process.env.VAPID_PRIVATE_KEY!,
            },
          },
        );
        return "sent";
      } catch (e) {
        return e &&
          typeof e === "object" &&
          "statusCode" in e &&
          [404, 410].includes(Number(e.statusCode))
          ? "expired"
          : "retry";
      }
    },
  };
  let sent = 0;
  // Small bounded batches avoid exceeding the free server execution window.
  for (let i = 0; i < rows.data.length; i += 5)
    await Promise.all(
      rows.data.slice(i, i + 5).map(async (row) => {
        const outcome = await channel.deliver(
          { endpoint: row.endpoint, keys: row.keys },
          { tag: row.tag, href: row.href },
        );
        const finished = await db.rpc("finish_push_delivery", {
          target: row.id,
          token: row.token,
          outcome,
        });
        if (!finished.error && outcome === "sent") sent++;
      }),
    );
  return Response.json({ claimed: rows.data.length, sent });
}
