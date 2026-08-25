"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { sendPasswordResetAction, updatePasswordAction } from "@/app/login/actions";

const INITIAL: { error?: string; ok?: boolean } = {};

export function ResetForms({ mode }: { mode: "request" | "set" }) {
  if (mode === "set") return <SetPasswordForm />;
  return <RequestResetForm />;
}

function RequestResetForm() {
  const [state, action] = useFormState(sendPasswordResetAction, INITIAL);

  if (state.ok) {
    return (
      <div className="space-y-4">
        <div
          className="rounded-[8px] px-3.5 py-2.5 text-[12.5px]"
          style={{
            backgroundColor: "rgba(74,222,128,0.10)",
            border: "1px solid rgba(74,222,128,0.28)",
            color: "#86EFAC",
          }}
        >
          If that email is authorized for MDF Outreach, a password reset link has been sent.
        </div>
        <Link href="/login" className="btn-secondary w-full justify-center">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <div
          className="rounded-[8px] px-3.5 py-2.5 text-[12.5px]"
          style={{
            backgroundColor: "rgba(239,108,92,0.08)",
            border: "1px solid rgba(239,108,92,0.28)",
            color: "#F08B7E",
          }}
        >
          {state.error}
        </div>
      )}
      <label className="block">
        <span className="label">Email</span>
        <input name="email" type="email" autoComplete="email" required className="input" autoFocus />
      </label>
      <SubmitButton label="Send reset link" pendingLabel="Sending…" />
      <div className="text-center pt-1">
        <Link href="/login" className="text-[12px] text-text-muted hover:text-text-secondary transition-colors">
          Back to sign in
        </Link>
      </div>
    </form>
  );
}

function SetPasswordForm() {
  const [state, action] = useFormState(updatePasswordAction, INITIAL);
  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <div
          className="rounded-[8px] px-3.5 py-2.5 text-[12.5px]"
          style={{
            backgroundColor: "rgba(239,108,92,0.08)",
            border: "1px solid rgba(239,108,92,0.28)",
            color: "#F08B7E",
          }}
        >
          {state.error}
        </div>
      )}
      <label className="block">
        <span className="label">New password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          className="input"
          autoFocus
        />
        <p className="mt-1 text-[11px] text-text-muted">At least 12 characters.</p>
      </label>
      <label className="block">
        <span className="label">Confirm new password</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          className="input"
        />
      </label>
      <SubmitButton label="Update password" pendingLabel="Updating…" />
    </form>
  );
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full justify-center" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}
