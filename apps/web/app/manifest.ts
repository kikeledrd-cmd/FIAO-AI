import type { MetadataRoute } from "next";

export const FIAO_BRANDING = {
  name: "FIAO",
  shortName: "FIAO",
  description: "Tu colmado, bajo control."
} as const;

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: FIAO_BRANDING.name,
    short_name: FIAO_BRANDING.shortName,
    description: FIAO_BRANDING.description,
    start_url: "/",
    display: "standalone",
    background_color: "#f7f8f7",
    theme_color: "#161a17",
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
