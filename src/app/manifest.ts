import { appName } from "@/lib/config";
import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appName,
    short_name: appName,
    description: "Thích Tính Tiền",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7f6",
    theme_color: "#087f66",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
