import { appName } from "@/lib/config";
import type { Metadata, Viewport } from "next";
import PWARuntime from "@/components/pwa-runtime";
import AppFrame from "@/components/app-frame";
import { localDevelopmentEnabled } from "@/lib/local-development";
import localFont from "next/font/local";
const beVietnam = localFont({
  src: [
    {
      path: "./fonts/BeVietnamPro-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/BeVietnamPro-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--font-be-vietnam",
  display: "swap",
});
import "./globals.css";
import "./frame.css";
import "./motion.css";
import "./theme.css";
import "./workspace.css";
import "./calendar-ux.css";
import "./bank-picker.css";
export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  robots: { index: false, follow: false },
  description: "Thích Tính Tiền — Chơi hết mình, chia tiền nhẹ tênh",
  manifest: "/manifest.webmanifest",
  referrer: "no-referrer",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "3T", statusBarStyle: "default" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b766e",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={beVietnam.variable}>
      <body>
        <PWARuntime />
        <AppFrame localDevelopment={localDevelopmentEnabled()}>
          {children}
        </AppFrame>
      </body>
    </html>
  );
}
