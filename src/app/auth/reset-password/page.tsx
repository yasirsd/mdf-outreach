import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { ResetForms } from "./ResetForms";

export const metadata: Metadata = {
  title: "Reset password · MDF Outreach",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage() {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const mode: "request" | "set" = user ? "set" : "request";

  return (
    <div className="min-h-screen bg-brand-ivory flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-11 h-11 rounded-xl bg-brand-charcoal grid place-items-center mb-4">
            <span className="font-serif font-semibold text-white text-[19px] leading-none pt-0.5">M</span>
          </div>
          <h1 className="font-serif text-[22px] tracking-[-0.015em] text-brand-charcoal">
            {mode === "set" ? "Set a new password" : "Reset password"}
          </h1>
          <p className="mt-1.5 text-[13px] text-brand-muted">
            {mode === "set"
              ? "Choose a new password for your MDF account."
              : "We'll email a reset link if this address is authorized."}
          </p>
        </div>

        <div className="card p-6">
          <ResetForms mode={mode} />
        </div>

        <p className="mt-6 text-center text-[11.5px] tracking-[0.06em] text-brand-muted">
          Authorized MDF personnel only
        </p>
      </div>
    </div>
  );
}
