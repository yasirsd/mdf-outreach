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
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-900">
          If that email is authorized for MDF Outreach, a password reset link has been sent.
        </div>
        <Link href="/login" className="btn-outline w-full justify-center">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-800">
          {state.error}
        </div>
      )}
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" />
      </div>
      <SubmitButton label="Send reset link" pendingLabel="Sending…" />
      <div className="text-center pt-1">
        <Link href="/login" className="text-[12.5px] text-brand-muted hover:text-brand-charcoal">
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
        <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-800">
          {state.error}
        </div>
      )}
      <div>
        <label htmlFor="password" className="label">New password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          className="input"
        />
        <p className="mt-1 text-[11.5px] text-brand-muted">At least 12 characters.</p>
      </div>
      <div>
        <label htmlFor="confirm" className="label">Confirm new password</label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          className="input"
        />
      </div>
      <SubmitButton label="Update password" pendingLabel="Updating…" />
    </form>
  );
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-brand w-full justify-center" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}
