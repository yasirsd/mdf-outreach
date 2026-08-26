import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { friendlyAssetError } from "./errors";

describe("friendlyAssetError", () => {
  const originalWarn = console.warn;
  beforeEach(() => {
    console.warn = vi.fn();
  });
  afterEach(() => {
    console.warn = originalWarn;
  });

  it("never leaks a raw Postgres/Supabase error code to the client message", () => {
    const raw = { code: "42P10", details: null, message: "no unique constraint" };
    const friendly = friendlyAssetError(raw);
    expect(friendly.message).not.toContain("42P10");
    expect(friendly.message).not.toContain("no unique constraint");
    expect(friendly.message).toContain("MDF administrator");
  });

  it("logs the raw error server-side for operators", () => {
    const raw = { code: "42P10", message: "no unique constraint" };
    friendlyAssetError(raw);
    expect(console.warn).toHaveBeenCalledWith(
      "[assets.error]",
      expect.objectContaining({ code: "42P10", message: "no unique constraint" }),
    );
  });

  it("maps 23505 to a duplicate-key hint", () => {
    const raw = { code: "23505", message: "duplicate key value violates unique constraint" };
    expect(friendlyAssetError(raw).message).toMatch(/already exists/i);
  });

  it("maps 42501 / permission denied / 403 to a permission message", () => {
    expect(friendlyAssetError({ code: "42501" }).message).toMatch(/permission/i);
    expect(friendlyAssetError({ message: "permission denied" }).message).toMatch(/permission/i);
    expect(friendlyAssetError({ status: 403 }).message).toMatch(/permission/i);
  });

  it("maps 413 / too large to a size message", () => {
    expect(friendlyAssetError({ status: 413 }).message).toMatch(/5 MB/i);
    expect(friendlyAssetError({ message: "Payload too large" }).message).toMatch(/5 MB/i);
  });

  it("maps RLS rejections to an operator-friendly message", () => {
    const friendly = friendlyAssetError({ message: "row-level security policy" });
    expect(friendly.message).toMatch(/Storage permissions/i);
    expect(friendly.message).not.toMatch(/row-level/i);
  });

  it("has a safe generic fallback for unknown errors", () => {
    expect(friendlyAssetError({ code: "unknown-thing" }).message).toBe(
      "Asset could not be saved. Please try again.",
    );
  });
});
