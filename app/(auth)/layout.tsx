import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "Login - MINS CCTV",
  description: "MINS CCTV",
};

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="min-h-screen bg-slate-50">{children}</div>;
}
