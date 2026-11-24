import { appName } from "@/lib/config";
import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${appName} · Thích Tính Tiền`,
    short_name: appName,
    description: "Thích Tính Tiền",
    start_url: "/",
    scope: "/",
    lang: "vi",
    display: "standalone",
    background_color: "#f5f7fb",
    theme_color: "#0b766e",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
