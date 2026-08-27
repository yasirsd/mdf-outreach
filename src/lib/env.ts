/**
 * MDF Outreach — F8 environment diagnostic.
 *
 * Consolidates the runtime env variables the app depends on and reports
 * their status without ever revealing the underlying secret values. This
 * is a DIAGNOSTIC helper — it does not throw or shortcircuit the app on
 * import; individual modules keep their own strict validators (see
 * `src/lib/auth/config.ts`, `src/lib/gmail/config.ts`).
 *
 * Two uses:
 *   1. A small internal /api endpoint or startup log can call
 *      `describeEnvironment()` to check what is / isn't configured.
 *   2. The BUYER_SEND_ENABLED boolean is exposed via `isBuyerSendEnabled`
 *      which parses the env value explicitly — no fuzzy "truthy" coercion.
 *
 * SECRET SAFETY: the returned status objects carry booleans and — for
 * non-secrets — length hints ONLY. No token, secret, key, URL or other
 * value is ever included. Existing `console.warn` sites are respected.
 */

export type EnvStatus = "ok" | "missing" | "invalid";

export interface EnvEntry {
  name: string;
  required: boolean;
  status: EnvStatus;
  /** Human-safe explanation. Never contains the raw value. */
  detail: string;
}

export interface EnvReport {
  entries: EnvEntry[];
  hasBlockingIssues: boolean;
}

const IANA_TZ_RE = /^[A-Za-z_]+\/[A-Za-z_+\-0-9]+(?:\/[A-Za-z_+\-0-9]+)?$|^UTC$/;

/**
 * Parse BUYER_SEND_ENABLED explicitly. Anything other than the literal
 * strings "1" / "true" / "yes" / "on" (case-insensitive) → false.
 * There is deliberately no default-on path — the gate opens only when
 * an operator has typed a truthy string into the env.
 */
export function isBuyerSendEnabled(
  raw: string | undefined = typeof process !== "undefined"
    ? process.env?.BUYER_SEND_ENABLED
    : undefined,
): boolean {
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Return a shape-only diagnostic for every env variable the app reads at
 * runtime. Never returns the actual values.
 */
export function describeEnvironment(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? (process.env as Record<string, string | undefined>) : {},
): EnvReport {
  const entries: EnvEntry[] = [];

  entries.push(checkPresent("NEXT_PUBLIC_SUPABASE_URL", env, true));
  entries.push(checkPresent("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", env, true));

  // App-session HMAC secret. Required. Must be at least 32 bytes to
  // avoid trivially-forgeable HMACs.
  const secret = env.APP_SESSION_SECRET?.trim() ?? "";
  entries.push(
    !secret
      ? {
          name: "APP_SESSION_SECRET",
          required: true,
          status: "missing",
          detail: "not set",
        }
      : secret.length < 32
        ? {
            name: "APP_SESSION_SECRET",
            required: true,
            status: "invalid",
            detail: "shorter than the 32-character minimum",
          }
        : { name: "APP_SESSION_SECRET", required: true, status: "ok", detail: "configured" },
  );

  // Gmail OAuth. Required for Gmail Test + Buyer Send.
  entries.push(checkPresent("GOOGLE_CLIENT_ID", env, true));
  entries.push(checkPresent("GOOGLE_CLIENT_SECRET", env, true));

  // AES-256-GCM encryption key. Must be 32 bytes (64 hex characters or
  // 44 base64 characters). Never logged.
  const key = env.GMAIL_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  const looksHex = /^[0-9a-fA-F]{64}$/.test(key);
  const looksB64 = /^[A-Za-z0-9+/=]{44}$/.test(key);
  entries.push(
    !key
      ? {
          name: "GMAIL_TOKEN_ENCRYPTION_KEY",
          required: true,
          status: "missing",
          detail: "not set",
        }
      : looksHex || looksB64
        ? { name: "GMAIL_TOKEN_ENCRYPTION_KEY", required: true, status: "ok", detail: "configured" }
        : {
            name: "GMAIL_TOKEN_ENCRYPTION_KEY",
            required: true,
            status: "invalid",
            detail: "not a valid 32-byte hex or base64 key",
          },
  );

  entries.push(checkPresent("APP_BASE_URL", env, true, (v) => {
    try {
      const u = new URL(v);
      return /^https?:$/.test(u.protocol);
    } catch {
      return false;
    }
  }));

  // Workspace timezone — optional, validated in dashboard/timezone.ts.
  const tz = env.MDF_WORKSPACE_TIMEZONE?.trim() ?? "";
  entries.push(
    !tz
      ? {
          name: "MDF_WORKSPACE_TIMEZONE",
          required: false,
          status: "ok",
          detail: "not set — defaults to Asia/Kolkata",
        }
      : IANA_TZ_RE.test(tz)
        ? { name: "MDF_WORKSPACE_TIMEZONE", required: false, status: "ok", detail: "configured" }
        : {
            name: "MDF_WORKSPACE_TIMEZONE",
            required: false,
            status: "invalid",
            detail: "not a valid IANA zone — will fall back to Asia/Kolkata",
          },
  );

  // BUYER_SEND_ENABLED — always parseable, but we report what will be
  // used. Not a required var; absent means false (safe default).
  const buyerSendEnabled = isBuyerSendEnabled(env.BUYER_SEND_ENABLED);
  entries.push({
    name: "BUYER_SEND_ENABLED",
    required: false,
    status: "ok",
    detail: buyerSendEnabled ? "true" : "false (safe default)",
  });

  const hasBlockingIssues = entries.some(
    (e) => e.required && e.status !== "ok",
  );

  return { entries, hasBlockingIssues };
}

function checkPresent(
  name: string,
  env: Record<string, string | undefined>,
  required: boolean,
  extraValidator?: (v: string) => boolean,
): EnvEntry {
  const raw = env[name]?.trim() ?? "";
  if (!raw) {
    return {
      name,
      required,
      status: required ? "missing" : "ok",
      detail: required ? "not set" : "not set (optional)",
    };
  }
  if (extraValidator && !extraValidator(raw)) {
    return { name, required, status: "invalid", detail: "value did not validate" };
  }
  return { name, required, status: "ok", detail: "configured" };
}
