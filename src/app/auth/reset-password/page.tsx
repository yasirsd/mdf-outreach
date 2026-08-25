import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { MdfWordmark } from "@/components/brand/MdfWordmark";
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
    <div
      className="min-h-screen flex items-center justify-center px-6 py-12"
      style={{ backgroundColor: "var(--app-bg)" }}
    >
      <div className="w-full max-w-[380px]">
        <div className="flex flex-col items-center text-center mb-8">
          <MdfWordmark tone="light" height={36} />
          <h1 className="mt-5 text-[18px] font-semibold tracking-tight text-text-primary">
            {mode === "set" ? "Set a new password" : "Reset password"}
          </h1>
          <p className="mt-2 text-[12.5px] text-text-muted">
            {mode === "set"
              ? "Choose a new password for your MDF account."
              : "We'll email a reset link if this address is authorized."}
          </p>
        </div>

        <div
          className="rounded-[14px] p-6"
          style={{
            backgroundColor: "var(--app-surface)",
            border: "1px solid var(--app-border)",
          }}
        >
          <ResetForms mode={mode} />
        </div>

        <p className="mt-6 text-center text-[11px] tracking-[0.14em] uppercase text-text-faint">
          Authorized MDF personnel only
        </p>
      </div>
    </div>
  );
}
