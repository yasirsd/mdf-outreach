import type { Metadata } from "next";
import { signOutAction } from "@/app/login/actions";

export const metadata: Metadata = {
  title: "Access not authorized · MDF Outreach",
  robots: { index: false, follow: false },
};

export default function AccessDeniedPage() {
  return (
    <div className="min-h-screen bg-brand-ivory flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[440px] text-center">
        <div className="w-11 h-11 rounded-xl bg-brand-charcoal grid place-items-center mx-auto mb-5">
          <span className="font-serif font-semibold text-white text-[19px] leading-none pt-0.5">M</span>
        </div>
        <h1 className="font-serif text-[26px] tracking-[-0.015em] text-brand-charcoal">
          Access not authorized
        </h1>
        <p className="mt-3 text-[13.5px] text-brand-muted leading-relaxed">
          This account is not authorized for MDF Outreach.
          <br />
          If you believe this is a mistake, contact your MDF administrator.
        </p>
        <form action={signOutAction} className="mt-8">
          <button type="submit" className="btn-outline mx-auto">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
