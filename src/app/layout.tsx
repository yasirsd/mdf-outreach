import type { Metadata } from "next";
import "./globals.css";
import { ToastHost } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "MDF Outreach",
  description: "Private buyer outreach & email campaigns for MDF Exports & Imports.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ToastHost />
      </body>
    </html>
  );
}
