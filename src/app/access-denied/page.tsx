import type { Metadata } from "next";
import { MdfWordmark } from "@/components/brand/MdfWordmark";
import { signOutAction } from "@/app/login/actions";

export const metadata: Metadata = {
  title: "Access not authorized · MDF Outreach",
  robots: { index: false, follow: false },
};

export default function AccessDeniedPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 py-12"
      style={{ backgroundColor: "var(--app-bg)" }}
    >
      <div className="w-full max-w-[440px] text-center">
        <div className="flex justify-center mb-6">
          <MdfWordmark tone="light" height={36} />
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight text-text-primary">
          Access not authorized
        </h1>
        <p className="mt-3 text-[13.5px] text-text-secondary leading-relaxed">
          This account is not authorized for MDF Outreach.
          <br />
          If you believe this is a mistake, contact your MDF administrator.
        </p>
        <form action={signOutAction} className="mt-8">
          <button type="submit" className="btn-secondary mx-auto">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
