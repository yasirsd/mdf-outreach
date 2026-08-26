import "server-only";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_USERINFO_SCOPES = ["openid", "email"] as const;

export const OAUTH_STATE_COOKIE = "mdf_gmail_oauth_state";
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export function requireGoogleClientId(): string {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new Error("GOOGLE_CLIENT_ID is not set");
  return v;
}
export function requireGoogleClientSecret(): string {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new Error("GOOGLE_CLIENT_SECRET is not set");
  return v;
}

/**
 * Dedicated server-only key used ONLY to encrypt / decrypt stored Gmail
 * OAuth tokens. Deliberately isolated from APP_SESSION_SECRET so that
 * rotating the app-session HMAC does not invalidate Gmail connections
 * and vice-versa.
 *
 * Generate a new value with:
 *   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
 *
 * Must be at least 32 chars. NEVER prefix with NEXT_PUBLIC_.
 */
export function requireGmailTokenEncryptionKey(): string {
  const v = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!v || v.length < 32) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY must be set (min 32 chars). Generate with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64'))\"",
    );
  }
  return v;
}

/**
 * Absolute callback URL for Google OAuth. Uses APP_BASE_URL if set
 * (recommended in production so we don't rely on request headers),
 * else falls back to reconstructing from the request.
 */
export function callbackUrlFor(origin: string): string {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "") || origin.replace(/\/$/, "");
  return `${base}/api/gmail/oauth/callback`;
}
