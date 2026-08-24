"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveMembership } from "@/lib/auth/membership";
import { buildLastActivityCookie, buildStartCookie } from "@/lib/auth/session";
import { performSignOut } from "@/lib/auth/signOut";

function isSecure(): boolean {
  return process.env.NODE_ENV === "production";
}

function safeNext(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.startsWith("/login") || next.startsWith("/auth/")) return "/";
  return next;
}

export interface LoginActionState {
  error?: string;
}

export async function signInAction(
  _prev: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? "/"));

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const cookieStore = cookies();
  const supabase = createClient(cookieStore);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    const code = (error as { code?: string } | null)?.code ?? null;
    const status = error?.status ?? null;
    const msg = error?.message ?? "";
    // Server-side categorized log; never exposes the password.
    console.warn("[auth.signIn] failed", {
      emailDomain: email.split("@")[1] ?? "",
      status,
      code,
      message: msg,
    });
    // Only "invalid credentials" gets the classic bad-password message.
    // Anything else — network, TLS, provider config, rate limiting — must
    // NOT be surfaced as "wrong password", because that misleads users
    // into re-entering (and possibly re-sending) their password.
    if (code === "invalid_credentials") {
      return { error: "Invalid email or password." };
    }
    if (code === "email_not_confirmed") {
      return { error: "Your account is not confirmed. Contact your administrator." };
    }
    if (code === "over_request_rate_limit" || status === 429) {
      return { error: "Too many attempts. Please wait a moment and try again." };
    }
    // fetch failed / status 0 / TLS error / DNS failure — this is a server-
    // side problem, not the user's password.
    if (status === 0 || /fetch failed|network|ENOTFOUND|ECONNREFUSED|certificate/i.test(msg)) {
      return { error: "Cannot reach the authentication server. Please try again shortly." };
    }
    return { error: "Sign in failed. Please try again." };
  }

  const membership = await getActiveMembership(supabase, data.user.id);
  if (!membership) {
    // Auth succeeded but no MDF membership. End the Supabase session immediately
    // so the browser cannot hold an authenticated-but-unauthorized token.
    await performSignOut();
    redirect("/access-denied");
  }

  const now = Date.now();
  const secure = isSecure();
  cookieStore.set(buildStartCookie(now, secure));
  cookieStore.set(buildLastActivityCookie(now, secure));

  redirect(next);
}

export async function sendPasswordResetAction(
  _prev: { error?: string; ok?: boolean },
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email." };

  const cookieStore = cookies();
  const supabase = createClient(cookieStore);
  const hdr = headers();
  const host = hdr.get("x-forwarded-host") ?? hdr.get("host") ?? "";
  const proto = hdr.get("x-forwarded-proto") ?? (isSecure() ? "https" : "http");
  const origin = host ? `${proto}://${host}` : "";
  const redirectTo = origin ? `${origin}/auth/callback?next=/auth/reset-password` : undefined;

  // Ignore return value: never disclose whether an address exists.
  await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  return { ok: true };
}

export async function updatePasswordAction(
  _prev: { error?: string; ok?: boolean },
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!password || password.length < 12) {
    return { error: "Password must be at least 12 characters." };
  }
  if (password !== confirm) return { error: "Passwords do not match." };

  const cookieStore = cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "This reset link is invalid or expired. Request a new one." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Could not update password. Try requesting a new reset link." };

  // Force a fresh login with the new password — do not silently start an app session here.
  await performSignOut();
  redirect("/login?reason=passwordreset");
}

export async function signOutAction(): Promise<void> {
  await performSignOut();
  redirect("/login");
}
