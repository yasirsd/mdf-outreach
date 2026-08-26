import { describe, it, expect } from "vitest";
import { base64UrlEncode, buildMimeRaw, quotedPrintable } from "./mime";

describe("MIME payload for Gmail", () => {
  const raw = buildMimeRaw({
    fromEmail: "sender@mdfexport.com",
    fromName: "MDF Exports & Imports",
    to: "buyer@example.com",
    replyTo: "reply@mdfexport.com",
    subject: "Guntur dry red chilli - offer",
    html: "<p>Hi</p>",
    text: "Hi",
  });

  it("is base64url-encoded (no padding, url-safe chars)", () => {
    expect(raw).toMatch(/^[A-Za-z0-9_\-]+$/);
    expect(raw.endsWith("=")).toBe(false);
  });

  it("contains a multipart/alternative envelope with both parts", () => {
    const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    expect(decoded).toMatch(/Content-Type: multipart\/alternative;\s*boundary="[^"]+"/);
    expect(decoded).toMatch(/Content-Type: text\/plain; charset=UTF-8/);
    expect(decoded).toMatch(/Content-Type: text\/html; charset=UTF-8/);
    expect(decoded).toMatch(/^From: "MDF Exports & Imports" <sender@mdfexport.com>$/m);
    expect(decoded).toMatch(/^To: buyer@example\.com$/m);
    expect(decoded).toMatch(/^Reply-To: reply@mdfexport\.com$/m);
    expect(decoded).toMatch(/Subject: Guntur dry red chilli - offer/);
  });

  it("quoted-printable encodes non-ASCII bytes", () => {
    const enc = quotedPrintable("India — chilli");
    expect(enc).toMatch(/=E2=80=94/); // U+2014
  });

  it("base64UrlEncode strips padding and uses -/_", () => {
    const b = Buffer.from("hello?/+world");
    const enc = base64UrlEncode(b);
    expect(enc.endsWith("=")).toBe(false);
    expect(enc).not.toContain("+");
    expect(enc).not.toContain("/");
  });
});
