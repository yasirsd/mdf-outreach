import { describe, it, expect, beforeAll } from "vitest";
import {
  buildLastActivityCookie,
  buildStartCookie,
  checkAppSession,
  parseEpoch,
  signCookieValue,
  verifyCookieValue,
} from "./session";
import { ABSOLUTE_SESSION_MS, IDLE_TIMEOUT_MS } from "./config";

beforeAll(() => {
  process.env.APP_SESSION_SECRET = "test-secret-that-is-at-least-32-chars-long-xxxxx";
});

describe("session cookie signing", () => {
  it("round-trips a signed value", () => {
    const signed = signCookieValue("1700000000000");
    expect(verifyCookieValue(signed)).toBe("1700000000000");
  });

  it("rejects tampered values", () => {
    const signed = signCookieValue("1700000000000");
    const [value, sig] = signed.split(".");
    expect(verifyCookieValue(`${value}1.${sig}`)).toBeNull();
  });

  it("rejects a value signed with a different secret", () => {
    const signed = signCookieValue("1700000000000");
    process.env.APP_SESSION_SECRET = "another-secret-that-is-at-least-32-chars-long-yyy";
    expect(verifyCookieValue(signed)).toBeNull();
    process.env.APP_SESSION_SECRET = "test-secret-that-is-at-least-32-chars-long-xxxxx";
  });

  it("returns null for empty or malformed", () => {
    expect(verifyCookieValue(undefined)).toBeNull();
    expect(verifyCookieValue(null)).toBeNull();
    expect(verifyCookieValue("")).toBeNull();
    expect(verifyCookieValue("no-dot")).toBeNull();
  });

  it("parses epoch numbers", () => {
    const signed = signCookieValue("1700000000000");
    expect(parseEpoch(signed)).toBe(1700000000000);
    expect(parseEpoch(signCookieValue("not-a-number"))).toBeNull();
  });
});

describe("checkAppSession policy", () => {
  const now = 1_700_000_000_000;

  it("fails when either cookie is missing", () => {
    expect(checkAppSession(undefined, undefined, now)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(
      checkAppSession(signCookieValue(String(now)), undefined, now),
    ).toEqual({ ok: false, reason: "missing" });
  });

  it("passes when both fresh", () => {
    const start = signCookieValue(String(now - 60_000));
    const last = signCookieValue(String(now - 30_000));
    const check = checkAppSession(start, last, now);
    expect(check.ok).toBe(true);
  });

  it("fails idle at 30 min + 1ms", () => {
    const start = signCookieValue(String(now - 60_000));
    const last = signCookieValue(String(now - IDLE_TIMEOUT_MS - 1));
    expect(checkAppSession(start, last, now)).toEqual({
      ok: false,
      reason: "expired_idle",
    });
  });

  it("fails absolute at 8h + 1ms even if just active", () => {
    const start = signCookieValue(String(now - ABSOLUTE_SESSION_MS - 1));
    const last = signCookieValue(String(now - 1_000));
    expect(checkAppSession(start, last, now)).toEqual({
      ok: false,
      reason: "expired_absolute",
    });
  });

  it("refresh (calling with same cookies) keeps session while inside limits", () => {
    const start = signCookieValue(String(now - 60_000));
    const last = signCookieValue(String(now - 60_000));
    expect(checkAppSession(start, last, now).ok).toBe(true);
    // Simulate a page refresh 5 minutes later without touching cookies.
    expect(checkAppSession(start, last, now + 5 * 60_000).ok).toBe(true);
  });

  it("refresh after absolute cap requires login", () => {
    const start = signCookieValue(String(now - ABSOLUTE_SESSION_MS + 60_000));
    const last = signCookieValue(String(now - 1_000));
    expect(checkAppSession(start, last, now).ok).toBe(true);
    // 2 minutes later crosses the absolute cap.
    const check = checkAppSession(start, last, now + 2 * 60_000);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe("expired_absolute");
  });

  it("browser restart within remaining lifetime does not create a fresh 8h", () => {
    // Session started 7h ago. Simulate a browser restart: last-activity
    // cookie is still there because it's persistent (not session-scoped).
    // Only 1h of the absolute cap is left.
    const start = signCookieValue(String(now - 7 * 60 * 60 * 1000));
    const last = signCookieValue(String(now - 10 * 60 * 1000));
    expect(checkAppSession(start, last, now).ok).toBe(true);
    // 90 min later we are past the 8h cap.
    const check = checkAppSession(start, last, now + 90 * 60_000);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe("expired_absolute");
  });
});

describe("cookie builders", () => {
  it("sets HttpOnly, SameSite=Lax, path=/, maxAge = absolute cap", () => {
    const c = buildStartCookie(Date.now(), false);
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("lax");
    expect(c.path).toBe("/");
    expect(c.maxAge).toBe(Math.ceil(ABSOLUTE_SESSION_MS / 1000));
  });

  it("last-activity cookie shares the same attributes", () => {
    const c = buildLastActivityCookie(Date.now(), true);
    expect(c.secure).toBe(true);
    expect(c.httpOnly).toBe(true);
  });
});
