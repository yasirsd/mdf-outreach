import type { Metadata } from "next";
import { MdfWordmark } from "@/components/brand/MdfWordmark";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in · MDF Outreach",
  robots: { index: false, follow: false },
};

const REASON_BANNERS: Record<string, string> = {
  expired: "Your session expired due to inactivity. Please sign in again.",
  unauth: "Please sign in to continue.",
  passwordreset: "Password updated. Please sign in with your new password.",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: { reason?: string; next?: string };
}) {
  const banner = searchParams.reason ? REASON_BANNERS[searchParams.reason] : undefined;
  const next = typeof searchParams.next === "string" ? searchParams.next : "/";

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 py-12"
      style={{ backgroundColor: "var(--app-bg)" }}
    >
      <div className="w-full max-w-[380px]">
        <div className="flex flex-col items-center text-center mb-8">
          <MdfWordmark tone="light" height={40} />
          <p className="mt-4 text-[12.5px] text-text-muted tracking-[0.02em]">
            Private company workspace
          </p>
        </div>

        <div
          className="rounded-[14px] p-6"
          style={{
            backgroundColor: "var(--app-surface)",
            border: "1px solid var(--app-border)",
          }}
        >
          <LoginForm next={next} banner={banner} />
        </div>

        <p className="mt-6 text-center text-[11px] tracking-[0.14em] uppercase text-text-faint">
          Authorized MDF personnel only
        </p>
      </div>
    </div>
  );
}
