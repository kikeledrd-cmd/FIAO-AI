import type { MetadataRoute } from "next";
import { FIAO_BRAND } from "@/lib/branding";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: FIAO_BRAND.name,
    short_name: FIAO_BRAND.name,
    description: FIAO_BRAND.description,
    start_url: "/",
    display: "standalone",
    background_color: FIAO_BRAND.colors.background,
    theme_color: FIAO_BRAND.colors.primary,
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      }
    ]
  };
}
