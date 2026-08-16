import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FIAO",
  description: "Tu colmado, bajo control.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FIAO"
  }
};

export const viewport: Viewport = {
  themeColor: "#161a17",
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
