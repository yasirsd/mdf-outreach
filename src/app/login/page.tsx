import type { Metadata } from "next";
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
    <div className="min-h-screen bg-brand-ivory flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-11 h-11 rounded-xl bg-brand-charcoal grid place-items-center mb-4">
            <span className="font-serif font-semibold text-white text-[19px] leading-none pt-0.5">M</span>
          </div>
          <h1 className="font-serif text-[26px] tracking-[-0.015em] text-brand-charcoal">
            MDF Outreach
          </h1>
          <p className="mt-1.5 text-[13px] text-brand-muted">
            Private company workspace
          </p>
        </div>

        <div className="card p-6">
          <LoginForm next={next} banner={banner} />
        </div>

        <p className="mt-6 text-center text-[11.5px] tracking-[0.06em] text-brand-muted">
          Authorized MDF personnel only
        </p>
      </div>
    </div>
  );
}
