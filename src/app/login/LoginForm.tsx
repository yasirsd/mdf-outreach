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
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900">
          {banner}
        </div>
      )}

      {state.error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-800"
        >
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="email" className="label">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="input"
        />
      </div>

      <div>
        <label htmlFor="password" className="label">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </div>

      <SubmitButton />

      <div className="text-center pt-1">
        <Link
          href="/auth/reset-password"
          className="text-[12.5px] text-brand-muted hover:text-brand-charcoal"
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
    <button
      type="submit"
      className="btn-brand w-full justify-center"
      disabled={pending}
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}
