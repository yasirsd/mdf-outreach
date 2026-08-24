import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ABSOLUTE_SESSION_MS,
  APP_SESSION_LAST_ACTIVITY_COOKIE,
  APP_SESSION_START_COOKIE,
  IDLE_TIMEOUT_MS,
  requireAppSessionSecret,
} from "./config";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function sign(value: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(value).digest());
}

export function signCookieValue(rawValue: string): string {
  const secret = requireAppSessionSecret();
  return `${rawValue}.${sign(rawValue, secret)}`;
}

export function verifyCookieValue(signed: string | undefined | null): string | null {
  if (!signed) return null;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const rawValue = signed.slice(0, dot);
  const providedSig = signed.slice(dot + 1);
  const secret = requireAppSessionSecret();
  const expectedSig = sign(rawValue, secret);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  try {
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return rawValue;
}

export function parseEpoch(signed: string | undefined | null): number | null {
  const raw = verifyCookieValue(signed);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export interface AppSessionState {
  startedAt: number;
  lastActivityAt: number;
}

export type AppSessionCheck =
  | { ok: true; state: AppSessionState }
  | { ok: false; reason: "missing" | "expired_idle" | "expired_absolute" };

export function checkAppSession(
  startedCookie: string | undefined | null,
  lastCookie: string | undefined | null,
  now: number = Date.now(),
): AppSessionCheck {
  const startedAt = parseEpoch(startedCookie);
  const lastActivityAt = parseEpoch(lastCookie);
  if (!startedAt || !lastActivityAt) return { ok: false, reason: "missing" };
  if (now - startedAt > ABSOLUTE_SESSION_MS) {
    return { ok: false, reason: "expired_absolute" };
  }
  if (now - lastActivityAt > IDLE_TIMEOUT_MS) {
    return { ok: false, reason: "expired_idle" };
  }
  return { ok: true, state: { startedAt, lastActivityAt } };
}

export interface CookieAttrs {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

export function buildStartCookie(startedAtMs: number, secure: boolean): CookieAttrs {
  return {
    name: APP_SESSION_START_COOKIE,
    value: signCookieValue(String(startedAtMs)),
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: Math.ceil(ABSOLUTE_SESSION_MS / 1000),
  };
}

export function buildLastActivityCookie(nowMs: number, secure: boolean): CookieAttrs {
  return {
    name: APP_SESSION_LAST_ACTIVITY_COOKIE,
    value: signCookieValue(String(nowMs)),
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: Math.ceil(ABSOLUTE_SESSION_MS / 1000),
  };
}

export function clearedAppSessionCookies(): Array<{
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: 0;
}> {
  const secure = process.env.NODE_ENV === "production";
  const base = { httpOnly: true as const, secure, sameSite: "lax" as const, path: "/" as const, maxAge: 0 as const, value: "" };
  return [
    { name: APP_SESSION_START_COOKIE, ...base },
    { name: APP_SESSION_LAST_ACTIVITY_COOKIE, ...base },
  ];
}

export function shouldTouch(lastActivityAt: number, now: number, minIntervalMs: number): boolean {
  return now - lastActivityAt >= minIntervalMs;
}
