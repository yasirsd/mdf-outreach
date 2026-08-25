import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { ToastHost } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "MDF Outreach",
  description: "Private buyer outreach & email campaigns for MDF Exports & Imports.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans antialiased">
        {children}
        <ToastHost />
      </body>
    </html>
  );
}
