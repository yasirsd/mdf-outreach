export const APP_SESSION_START_COOKIE = "mdf_ses_start";
export const APP_SESSION_LAST_ACTIVITY_COOKIE = "mdf_ses_last";

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const ABSOLUTE_SESSION_MS = 8 * 60 * 60 * 1000;

export const TOUCH_MIN_INTERVAL_MS = 60 * 1000;

export const PUBLIC_ROUTES = [
  "/login",
  "/auth/reset-password",
  "/auth/callback",
  "/auth/sign-out",
  "/access-denied",
] as const;

export function isPublicRoute(pathname: string): boolean {
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname === "/favicon.ico") return true;
  return PUBLIC_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + "/"),
  );
}

export function isTouchRoute(pathname: string): boolean {
  return pathname === "/api/app-session/touch";
}

export function loginRedirect(reason?: "expired" | "denied" | "unauth", next?: string): string {
  const params = new URLSearchParams();
  if (reason) params.set("reason", reason);
  if (next && next !== "/login") params.set("next", next);
  const q = params.toString();
  return q ? `/login?${q}` : "/login";
}

export function requireAppSessionSecret(): string {
  const s = process.env.APP_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "APP_SESSION_SECRET must be set (min 32 chars). Generate with: openssl rand -base64 48",
    );
  }
  return s;
}
