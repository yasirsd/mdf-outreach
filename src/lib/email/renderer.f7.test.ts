import { describe, expect, it } from "vitest";
import { renderEmailHtml } from "./renderer";
import { buildProductTemplate } from "./templates/build";
import { createDefaultSettings } from "@/test/fixtures/demo";
import type { ProductKey } from "@/lib/email/themes/types";
import type { WorkspaceSettings } from "@/lib/types";

const settings: WorkspaceSettings = {
  ...createDefaultSettings(),
  onboardingComplete: true,
};

const PRODUCTS: ProductKey[] = [
  "guntur-chilli",
  "banganapalli-mango",
  "pomegranate",
  "indian-apple",
];

function renderMaster(product: ProductKey, variant: "signature" | "direct"): string {
  return renderEmailHtml({
    template: buildProductTemplate(product, variant),
    buyer: null,
    settings,
    assetsBySlot: {},
  });
}

/*
 * F7 — Premium Creative Refresh regressions.
 *
 * Focus of this file: the F7 elevations proper (per-product decorative
 * mark, editorial masthead, Signature-vs-Direct length ratio). Existing
 * renderer.test.ts / renderer.direct.visibility.test.ts / preheader
 * tests cover the protected contracts and are still green.
 */

describe("F7 — per-product decorative marks", () => {
  it.each(PRODUCTS)("Signature %s renders an inline decorative SVG mark", (product) => {
    const html = renderMaster(product, "signature");
    // Inline SVG, marked decorative.
    expect(html).toContain('role="presentation"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/<svg[^>]*viewBox="0 0 44 44"/);
  });

  it.each(PRODUCTS)("Direct %s renders an inline decorative SVG mark", (product) => {
    const html = renderMaster(product, "direct");
    expect(html).toMatch(/<svg[^>]*viewBox="0 0 44 44"/);
    expect(html).toContain('aria-hidden="true"');
  });

  it("no product mark carries alt text — SVG uses aria-hidden, never a meaningful label", () => {
    for (const product of PRODUCTS) {
      const html = renderMaster(product, "signature");
      // The mark's SVG element must not carry an aria-label / role="img".
      // A visible <img> hero elsewhere on the page may of course have alt.
      // Guardrail: the SVG we author is always presentational.
      const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
      for (const s of svgs) {
        if (s.includes("aria-hidden")) {
          expect(s).not.toMatch(/aria-label=/);
          expect(s).not.toMatch(/role="img"/);
        }
      }
    }
  });
});

describe("F7 — editorial masthead", () => {
  it("renders MDF company wordmark near the top of every master", () => {
    for (const product of PRODUCTS) {
      for (const variant of ["signature", "direct"] as const) {
        const html = renderMaster(product, variant);
        // Tracked capital wordmark row appears before the hero content.
        expect(html).toMatch(/letter-spacing:0\.28em/);
        // Company name may include an ampersand — the renderer HTML-escapes.
        expect(html).toContain(
          settings.company.companyName.replace(/&/g, "&amp;"),
        );
      }
    }
  });

  it("displays the product family name in the masthead when the template has a known themeKey", () => {
    const html = renderMaster("guntur-chilli", "signature");
    // The masthead prints the product name using the theme registry
    // (Guntur Dry Red Chilli) — real HTML text, not baked into an image.
    expect(html).toContain("Guntur Dry Red Chilli");
  });
});

describe("F7 — Signature vs Direct are materially different", () => {
  it.each(PRODUCTS)("Direct %s is at least 25% shorter than Signature", (product) => {
    const sig = renderMaster(product, "signature");
    const dir = renderMaster(product, "direct");
    // Direct must be visibly shorter — not "Signature with fewer sections".
    // 25% is the loose lower bound; in practice Direct is ~40-60% shorter.
    const ratio = dir.length / sig.length;
    expect(ratio).toBeLessThanOrEqual(0.75);
  });
});

describe("F7 — HTML size envelope for every master", () => {
  it.each(PRODUCTS)("Signature %s stays under 60 KB total", (product) => {
    const html = renderMaster(product, "signature");
    // Comfortable envelope for a rich Signature email. Well below the
    // ~102 KB Gmail clip threshold and typical bounce concerns.
    const kb = Buffer.byteLength(html, "utf8") / 1024;
    expect(kb).toBeLessThan(60);
    expect(html.length).toBeGreaterThan(3000); // non-trivial content
  });

  it.each(PRODUCTS)("Direct %s stays under 30 KB total", (product) => {
    const html = renderMaster(product, "direct");
    const kb = Buffer.byteLength(html, "utf8") / 1024;
    expect(kb).toBeLessThan(30);
    expect(html.length).toBeGreaterThan(1500);
  });
});

describe("F7 — production HTML safety (no dev-only URLs, no base64)", () => {
  it.each(PRODUCTS)("Signature %s HTML has no Base64/localhost/blob URLs", (product) => {
    const html = renderMaster(product, "signature");
    expect(html).not.toMatch(/data:image\/[a-z]+;base64,/i);
    expect(html).not.toMatch(/blob:/i);
    expect(html).not.toMatch(/localhost/i);
    expect(html).not.toMatch(/127\.0\.0\.1/);
  });

  it.each(PRODUCTS)("Direct %s HTML has no Base64/localhost/blob URLs", (product) => {
    const html = renderMaster(product, "direct");
    expect(html).not.toMatch(/data:image\/[a-z]+;base64,/i);
    expect(html).not.toMatch(/blob:/i);
    expect(html).not.toMatch(/localhost/i);
    expect(html).not.toMatch(/127\.0\.0\.1/);
  });

  it("no critical email-unsafe CSS is required anywhere", () => {
    for (const product of PRODUCTS) {
      for (const variant of ["signature", "direct"] as const) {
        const html = renderMaster(product, variant);
        expect(html).not.toMatch(/display:\s*grid/i);
        expect(html).not.toMatch(/display:\s*flex/i);
        expect(html).not.toMatch(/clip-path\s*:/i);
        expect(html).not.toMatch(/backdrop-filter/i);
        expect(html).not.toMatch(/position:\s*absolute/i);
      }
    }
  });
});

describe("F7 — decorative slots never become required by the mark", () => {
  it("removing hero asset does NOT stop the mark from rendering", () => {
    // The mark is inline SVG; it does not consume any asset slot at all.
    const html = renderMaster("guntur-chilli", "signature");
    expect(html).toContain("Awaiting approved production asset");
    // Mark still there.
    expect(html).toMatch(/<svg[^>]*viewBox="0 0 44 44"/);
  });
});
