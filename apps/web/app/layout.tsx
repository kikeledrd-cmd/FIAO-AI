import type { Metadata, Viewport } from "next";
import { FIAO_BRAND } from "@/lib/branding";
import "./globals.css";

export const metadata: Metadata = {
  title: FIAO_BRAND.name,
  description: FIAO_BRAND.description,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: FIAO_BRAND.name
  }
};

export const viewport: Viewport = {
  themeColor: FIAO_BRAND.colors.primary,
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
