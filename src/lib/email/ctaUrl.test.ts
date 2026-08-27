import { describe, expect, it } from "vitest";
import { isValidCtaUrl, preflightCtaUrls } from "./ctaUrl";
import { buildProductTemplate } from "./templates/build";
import type { EmailSection, EmailTemplate } from "@/lib/types";

describe("isValidCtaUrl", () => {
  it("accepts absolute HTTPS URLs", () => {
    expect(isValidCtaUrl("https://www.mdfexport.com/contact")).toBe(true);
    expect(isValidCtaUrl("https://wa.me/919999999999")).toBe(true);
  });

  it("accepts absolute HTTP URLs (rare but legitimate)", () => {
    expect(isValidCtaUrl("http://www.example.com/enquire")).toBe(true);
  });

  it("accepts mailto with a proper address", () => {
    expect(isValidCtaUrl("mailto:hello@mdfexport.com")).toBe(true);
    expect(isValidCtaUrl("mailto:hello@mdfexport.com?subject=Hi")).toBe(true);
  });

  it("accepts tel: with a phone number", () => {
    expect(isValidCtaUrl("tel:+91 984-000-0000")).toBe(true);
  });

  it("rejects empty / whitespace / #", () => {
    expect(isValidCtaUrl("")).toBe(false);
    expect(isValidCtaUrl("   ")).toBe(false);
    expect(isValidCtaUrl("#")).toBe(false);
  });

  it("rejects javascript: / data: / blob: / vbscript: / file: / ftp:", () => {
    expect(isValidCtaUrl("javascript:alert(1)")).toBe(false);
    expect(isValidCtaUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isValidCtaUrl("blob:https://example.com/x")).toBe(false);
    expect(isValidCtaUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isValidCtaUrl("file:///etc/passwd")).toBe(false);
    expect(isValidCtaUrl("ftp://old.example.com")).toBe(false);
  });

  it("rejects relative and localhost URLs", () => {
    expect(isValidCtaUrl("/enquire")).toBe(false);
    expect(isValidCtaUrl("contact")).toBe(false);
    expect(isValidCtaUrl("http://localhost:3000/enquire")).toBe(false);
    expect(isValidCtaUrl("http://127.0.0.1:3000/enquire")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isValidCtaUrl("https://")).toBe(false);
    expect(isValidCtaUrl("http:// bad url")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidCtaUrl(null)).toBe(false);
    expect(isValidCtaUrl(undefined)).toBe(false);
    expect(isValidCtaUrl(123)).toBe(false);
    expect(isValidCtaUrl({})).toBe(false);
  });
});

function makeTemplate(sections: EmailSection[], variant: "signature" | "direct" = "signature"): EmailTemplate {
  return {
    id: "tpl",
    name: "Test",
    sections,
    createdAt: "",
    updatedAt: "",
    themeKey: "guntur-chilli",
    variant,
    status: "approved",
  };
}

function section(type: string, over: Partial<EmailSection> = {}): EmailSection {
  return {
    id: type,
    type: type as EmailSection["type"],
    visible: true,
    data: {},
    ...over,
  };
}

describe("preflightCtaUrls — Signature", () => {
  it("visible CTA with a valid absolute URL passes", () => {
    const t = makeTemplate([
      section("cta", { data: { ctaLabel: "Request price", ctaUrl: "https://www.mdfexport.com/enquire" } }),
    ]);
    expect(preflightCtaUrls(t)).toEqual([]);
  });

  it("visible CTA with empty URL BLOCKS with a 'missing' finding", () => {
    const t = makeTemplate([
      section("cta", { data: { ctaLabel: "Request price", ctaUrl: "" } }),
    ]);
    const findings = preflightCtaUrls(t);
    expect(findings.length).toBe(1);
    expect(findings[0].reason).toBe("missing");
  });

  it("visible CTA with '#' BLOCKS with an 'invalid' finding", () => {
    const t = makeTemplate([
      section("cta", { data: { ctaLabel: "Go", ctaUrl: "#" } }),
    ]);
    const findings = preflightCtaUrls(t);
    expect(findings.length).toBe(1);
    expect(findings[0].reason).toBe("invalid");
  });

  it("visible CTA with javascript: URL BLOCKS", () => {
    const t = makeTemplate([
      section("cta", { data: { ctaLabel: "Go", ctaUrl: "javascript:alert(1)" } }),
    ]);
    expect(preflightCtaUrls(t)[0].reason).toBe("invalid");
  });

  it("visible CTA with localhost URL BLOCKS a production send", () => {
    const t = makeTemplate([
      section("cta", { data: { ctaLabel: "Go", ctaUrl: "http://localhost/enquire" } }),
    ]);
    expect(preflightCtaUrls(t)[0].reason).toBe("invalid");
  });

  it("HIDDEN CTA section does NOT block regardless of URL state", () => {
    const t = makeTemplate([
      section("cta", { visible: false, data: { ctaLabel: "Go", ctaUrl: "#" } }),
    ]);
    expect(preflightCtaUrls(t)).toEqual([]);
  });

  it("CTA section visible but with NO label produces NO button and NO finding", () => {
    // Renderer emits no button when ctaLabel is empty even if URL is set/missing.
    const t = makeTemplate([
      section("cta", { data: { ctaLabel: "", ctaUrl: "" } }),
    ]);
    expect(preflightCtaUrls(t)).toEqual([]);
  });

  it("blocker copy mentions web / email / telephone — matching the actual accepted contract", () => {
    const t = makeTemplate([
      section("cta", { data: { ctaLabel: "Go", ctaUrl: "javascript:alert(1)" } }),
    ]);
    const findings = preflightCtaUrls(t);
    expect(findings[0].message).toContain("web");
    expect(findings[0].message).toContain("email");
    expect(findings[0].message).toContain("telephone");
    // The pre-F9 copy said "HTTP/HTTPS" — must be gone.
    expect(findings[0].message).not.toContain("HTTP/HTTPS");
  });

  it("independently validates hero + packing + cta buttons", () => {
    const t = makeTemplate([
      section("hero", { data: { ctaLabel: "Learn", ctaUrl: "https://ok.example.com" } }),
      section("packing", { data: { ctaLabel: "Details", ctaUrl: "#" } }),
      section("cta", { data: { ctaLabel: "Enquire", ctaUrl: "https://www.mdfexport.com" } }),
    ]);
    const findings = preflightCtaUrls(t);
    // Only the packing one is bad.
    expect(findings.length).toBe(1);
    expect(findings[0].section).toBe("packing");
  });
});

describe("preflightCtaUrls — Direct", () => {
  it("Direct with NO button (no label anywhere) does NOT block on URL", () => {
    const t = makeTemplate(
      [
        section("intro", { data: { greeting: "Hello,", body: "..." } }),
        section("hero", { data: { headline: "Hi", ctaLabel: "" } }),
        section("cta", { data: { ctaLabel: "" } }),
      ],
      "direct",
    );
    expect(preflightCtaUrls(t)).toEqual([]);
  });

  it("Direct with a rendered button but missing URL BLOCKS", () => {
    const t = makeTemplate(
      [
        section("intro", { data: { greeting: "Hello,", body: "..." } }),
        section("hero", { data: { headline: "Hi", ctaLabel: "Request price", ctaUrl: "" } }),
      ],
      "direct",
    );
    const f = preflightCtaUrls(t);
    expect(f.length).toBe(1);
    expect(f[0].section).toBe("direct-hero");
    expect(f[0].reason).toBe("missing");
  });

  it("Direct falls back cta.ctaUrl → hero.ctaUrl and validates the resolved URL", () => {
    const t = makeTemplate(
      [
        section("intro"),
        section("hero", { data: { headline: "Hi", ctaLabel: "Request price", ctaUrl: "https://www.mdfexport.com" } }),
        section("cta", { data: { ctaLabel: "Enquire", ctaUrl: "#" } }),
      ],
      "direct",
    );
    // cta.ctaUrl='#' is invalid — should block even though hero.ctaUrl is valid,
    // because the renderer prefers cta.ctaUrl first.
    const f = preflightCtaUrls(t);
    expect(f.length).toBe(1);
    expect(f[0].reason).toBe("invalid");
  });
});

describe("preflightCtaUrls — 8 built-in masters", () => {
  it("every product master has an empty CTA URL — signalling operator must set before send", () => {
    // buildProductTemplate leaves ctaUrl:"" so the Settings default seeds
    // it during campaign creation. That means every un-seeded master
    // template DOES block preflight, which is the intended behaviour.
    for (const key of ["guntur-chilli", "banganapalli-mango", "pomegranate", "indian-apple"] as const) {
      for (const variant of ["signature", "direct"] as const) {
        const t = buildProductTemplate(key, variant);
        const findings = preflightCtaUrls(t);
        expect(findings.length).toBeGreaterThan(0);
      }
    }
  });
});
