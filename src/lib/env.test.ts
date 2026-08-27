import { describe, expect, it } from "vitest";
import { describeEnvironment, isBuyerSendEnabled } from "./env";

describe("isBuyerSendEnabled — explicit boolean parsing", () => {
  it("returns false for unset / empty / arbitrary strings", () => {
    expect(isBuyerSendEnabled(undefined)).toBe(false);
    expect(isBuyerSendEnabled("")).toBe(false);
    expect(isBuyerSendEnabled(" ")).toBe(false);
    expect(isBuyerSendEnabled("maybe")).toBe(false);
    expect(isBuyerSendEnabled("0")).toBe(false);
    expect(isBuyerSendEnabled("false")).toBe(false);
    expect(isBuyerSendEnabled("no")).toBe(false);
    expect(isBuyerSendEnabled("off")).toBe(false);
  });

  it("returns true ONLY for the explicit truthy strings", () => {
    expect(isBuyerSendEnabled("1")).toBe(true);
    expect(isBuyerSendEnabled("true")).toBe(true);
    expect(isBuyerSendEnabled("True")).toBe(true);
    expect(isBuyerSendEnabled(" TRUE ")).toBe(true);
    expect(isBuyerSendEnabled("yes")).toBe(true);
    expect(isBuyerSendEnabled("on")).toBe(true);
  });
});

describe("describeEnvironment — diagnostic (never returns secrets)", () => {
  const okEnv = {
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "eyJhb…anon…",
    APP_SESSION_SECRET: "a".repeat(64),
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    GMAIL_TOKEN_ENCRYPTION_KEY: "a".repeat(64), // 32-byte hex
    APP_BASE_URL: "https://outreach.mdfexport.com",
    MDF_WORKSPACE_TIMEZONE: "Asia/Kolkata",
    BUYER_SEND_ENABLED: "false",
  };

  it("reports OK for a fully-configured environment", () => {
    const r = describeEnvironment(okEnv);
    expect(r.hasBlockingIssues).toBe(false);
    for (const e of r.entries) {
      if (e.required) expect(e.status).toBe("ok");
    }
  });

  it("flags missing required variables as blocking", () => {
    const r = describeEnvironment({});
    expect(r.hasBlockingIssues).toBe(true);
    const bad = r.entries.filter((e) => e.status !== "ok");
    expect(bad.some((e) => e.name === "NEXT_PUBLIC_SUPABASE_URL")).toBe(true);
    expect(bad.some((e) => e.name === "APP_SESSION_SECRET")).toBe(true);
    expect(bad.some((e) => e.name === "GMAIL_TOKEN_ENCRYPTION_KEY")).toBe(true);
  });

  it("flags an APP_SESSION_SECRET shorter than 32 characters as invalid", () => {
    const r = describeEnvironment({ ...okEnv, APP_SESSION_SECRET: "short" });
    const secret = r.entries.find((e) => e.name === "APP_SESSION_SECRET");
    expect(secret?.status).toBe("invalid");
  });

  it("flags an APP_BASE_URL that is not http(s) as invalid", () => {
    const r = describeEnvironment({ ...okEnv, APP_BASE_URL: "ftp://foo" });
    const base = r.entries.find((e) => e.name === "APP_BASE_URL");
    expect(base?.status).toBe("invalid");
  });

  it("flags an invalid MDF_WORKSPACE_TIMEZONE (non-blocking — optional)", () => {
    const r = describeEnvironment({ ...okEnv, MDF_WORKSPACE_TIMEZONE: "not-a-zone" });
    const tz = r.entries.find((e) => e.name === "MDF_WORKSPACE_TIMEZONE");
    expect(tz?.status).toBe("invalid");
    expect(r.hasBlockingIssues).toBe(false); // optional
  });

  it("MDF_WORKSPACE_TIMEZONE unset → OK with 'defaults to Asia/Kolkata' detail", () => {
    const r = describeEnvironment({ ...okEnv, MDF_WORKSPACE_TIMEZONE: undefined });
    const tz = r.entries.find((e) => e.name === "MDF_WORKSPACE_TIMEZONE");
    expect(tz?.status).toBe("ok");
    expect(tz?.detail).toContain("Asia/Kolkata");
  });

  it("reports BUYER_SEND_ENABLED = false (safe default) when unset", () => {
    const r = describeEnvironment({ ...okEnv, BUYER_SEND_ENABLED: undefined });
    const g = r.entries.find((e) => e.name === "BUYER_SEND_ENABLED");
    expect(g?.detail).toContain("false");
  });

  it("NEVER leaks the raw secret / key value in details", () => {
    const r = describeEnvironment({
      ...okEnv,
      APP_SESSION_SECRET: "REVEAL_ME_SESSION_SECRET_" + "x".repeat(48),
      GMAIL_TOKEN_ENCRYPTION_KEY: "REVEAL_ME_KEY_" + "y".repeat(56),
      GOOGLE_CLIENT_SECRET: "REVEAL_ME_OAUTH_SECRET",
    });
    for (const e of r.entries) {
      expect(e.detail).not.toContain("REVEAL_ME");
    }
  });
});
