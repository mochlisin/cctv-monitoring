import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: `${process.env.NEXT_PUBLIC_APP_TITLE || "MINS CCTV"} - ${process.env.NEXT_PUBLIC_DESC || "CCTV Masyarakat"}`,
  description: process.env.NEXT_PUBLIC_DESC || "CCTV Masyarakat",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CCTV Sasmito",
  },
};

/**
 * viewportFit: "cover" wajib supaya env(safe-area-inset-*) terisi di ponsel
 * berponi/berhome-indicator — tanpa itu utilitas .safe-pb selalu 0.
 * maximumScale dibiarkan default (bisa di-zoom) demi aksesibilitas.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
