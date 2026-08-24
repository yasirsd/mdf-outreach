import { describe, it, expect } from "vitest";
import { isPublicRoute, isTouchRoute, loginRedirect } from "./config";

describe("route classification", () => {
  it("recognizes login and auth routes as public", () => {
    expect(isPublicRoute("/login")).toBe(true);
    expect(isPublicRoute("/auth/reset-password")).toBe(true);
    expect(isPublicRoute("/auth/callback")).toBe(true);
    expect(isPublicRoute("/access-denied")).toBe(true);
    expect(isPublicRoute("/api/auth/sign-out")).toBe(true);
    expect(isPublicRoute("/_next/static/x.js")).toBe(true);
    expect(isPublicRoute("/favicon.ico")).toBe(true);
  });

  it("treats everything else as protected", () => {
    expect(isPublicRoute("/")).toBe(false);
    expect(isPublicRoute("/buyers")).toBe(false);
    expect(isPublicRoute("/campaigns")).toBe(false);
    expect(isPublicRoute("/campaigns/abc-123")).toBe(false);
    expect(isPublicRoute("/settings")).toBe(false);
    expect(isPublicRoute("/api/app-session/touch")).toBe(false);
    expect(isPublicRoute("/activity")).toBe(false);
  });

  it("does not mistake similar-looking prefixes for public routes", () => {
    expect(isPublicRoute("/logins-and-signouts")).toBe(false);
    expect(isPublicRoute("/authorized-users")).toBe(false);
  });

  it("marks the touch route correctly", () => {
    expect(isTouchRoute("/api/app-session/touch")).toBe(true);
    expect(isTouchRoute("/api/app-session/touch/nope")).toBe(false);
  });

  it("builds login redirect with reason + next", () => {
    expect(loginRedirect("expired", "/buyers")).toBe("/login?reason=expired&next=%2Fbuyers");
    expect(loginRedirect("unauth")).toBe("/login?reason=unauth");
    expect(loginRedirect()).toBe("/login");
    // Never loop back to /login.
    expect(loginRedirect("unauth", "/login")).toBe("/login?reason=unauth");
  });
});
