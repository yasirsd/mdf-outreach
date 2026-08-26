import { describe, it, expect, beforeAll } from "vitest";
import { decryptString, encryptString } from "./crypto";

beforeAll(() => {
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY =
    "test-gmail-token-key-that-is-at-least-32-chars-long-xxxx";
});

describe("gmail token encryption (AES-256-GCM)", () => {
  it("round-trips a token", () => {
    const enc = encryptString("ya29.a0AeXRPp7dummy");
    expect(enc.ciphertext.length).toBeGreaterThan(0);
    expect(enc.iv.length).toBeGreaterThan(0);
    expect(enc.tag.length).toBeGreaterThan(0);
    expect(decryptString(enc)).toBe("ya29.a0AeXRPp7dummy");
  });

  it("produces a different ciphertext each time (IV is random)", () => {
    const a = encryptString("x");
    const b = encryptString("x");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it("rejects tampered ciphertext", () => {
    const enc = encryptString("secret");
    expect(() =>
      decryptString({
        ...enc,
        ciphertext: Buffer.from(enc.ciphertext, "base64").toString("base64").replace(/^./, "A"),
      }),
    ).toThrow();
  });

  it("rejects tampered auth tag", () => {
    const enc = encryptString("secret");
    expect(() => decryptString({ ...enc, tag: "AAAAAAAAAAAAAAAAAAAAAA==" })).toThrow();
  });

  it("does not use APP_SESSION_SECRET — Gmail token key is isolated", async () => {
    const savedKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
    const savedApp = process.env.APP_SESSION_SECRET;
    try {
      // With the Gmail key removed but APP_SESSION_SECRET still set,
      // encrypt/decrypt must FAIL. This proves the two are not shared.
      delete process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
      process.env.APP_SESSION_SECRET = "still-set-and-long-enough-for-app-session-hmac-x";
      expect(() => encryptString("x")).toThrow(/GMAIL_TOKEN_ENCRYPTION_KEY/);
    } finally {
      process.env.GMAIL_TOKEN_ENCRYPTION_KEY = savedKey;
      process.env.APP_SESSION_SECRET = savedApp;
    }
  });

  it("rejects a key shorter than 32 chars", () => {
    const saved = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY = "too-short";
    try {
      expect(() => encryptString("x")).toThrow(/at least 32 chars|min 32 chars/i);
    } finally {
      process.env.GMAIL_TOKEN_ENCRYPTION_KEY = saved;
    }
  });

  it("data encrypted under one key cannot be decrypted under a rotated key", () => {
    const saved = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
    const enc = encryptString("access-token-original");
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY =
      "a-different-key-that-is-also-at-least-32-chars-long";
    try {
      expect(() => decryptString(enc)).toThrow();
    } finally {
      process.env.GMAIL_TOKEN_ENCRYPTION_KEY = saved;
    }
  });
});
