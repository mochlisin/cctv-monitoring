import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "Login - {process.env.NEXT_PUBLIC_APP_TITLE || 'MINS CCTV'}",
  description: "{process.env.NEXT_PUBLIC_APP_TITLE || 'MINS CCTV'}",
};

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="min-h-screen bg-slate-50">{children}</div>;
}
