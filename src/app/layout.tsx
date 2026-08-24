import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { WorkspaceProvider } from "@/components/WorkspaceProvider";
import { ToastHost } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "MDF Outreach",
  description: "Buyer outreach & email campaigns for MDF Exports & Imports.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WorkspaceProvider>
          <AppShell>{children}</AppShell>
          <ToastHost />
        </WorkspaceProvider>
      </body>
    </html>
  );
}
