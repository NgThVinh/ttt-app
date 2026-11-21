import { appName } from "@/lib/config";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: appName,
  description: "Thích Tính Tiền — Chơi hết mình, chia tiền nhẹ tênh",
  manifest: "/manifest.webmanifest",
  referrer: "no-referrer",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
