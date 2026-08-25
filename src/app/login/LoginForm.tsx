"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { signInAction, type LoginActionState } from "./actions";

const INITIAL: LoginActionState = {};

export function LoginForm({
  next,
  banner,
}: {
  next: string;
  banner?: string;
}) {
  const [state, formAction] = useFormState(signInAction, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      {banner && (
        <div
          role="status"
          className="rounded-[8px] px-3.5 py-2.5 text-[12.5px]"
          style={{
            backgroundColor: "rgba(243,107,33,0.08)",
            border: "1px solid rgba(243,107,33,0.24)",
            color: "#F8894C",
          }}
        >
          {banner}
        </div>
      )}

      {state.error && (
        <div
          role="alert"
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
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="input"
          autoFocus
        />
      </label>

      <label className="block">
        <span className="label">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </label>

      <SubmitButton />

      <div className="text-center pt-1">
        <Link
          href="/auth/reset-password"
          className="text-[12px] text-text-muted hover:text-text-secondary transition-colors"
        >
          Forgot password?
        </Link>
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full justify-center" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}
