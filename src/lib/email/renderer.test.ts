import { describe, it, expect } from "vitest";
import { renderEmailHtml, renderEmailText } from "./renderer";
import { buildProductTemplate } from "./templates/build";
import { createDefaultSettings } from "@/test/fixtures/demo";
import { getProductTheme } from "@/lib/email/themes/registry";
import type { WorkspaceSettings } from "@/lib/types";

const settings: WorkspaceSettings = {
  ...createDefaultSettings(),
  onboardingComplete: true,
};

describe("renderer — Signature composition", () => {
  const template = buildProductTemplate("guntur-chilli", "signature");
  const html = renderEmailHtml({
    template,
    buyer: null,
    settings,
    assetsBySlot: {},
  });

  it("emits a modern rounded email container", () => {
    // The container uses a border-radius (Signature enhancement).
    expect(html).toMatch(/border-radius:24px/);
  });

  it("renders every visible Signature section as real HTML text", () => {
    // Renderer should include the eyebrow, headline, trust card, formats,
    // packing headline, why headline, CTA button label — all real text.
    expect(html).toContain("Guntur Dry Red Chilli");
    expect(html).toContain("40+");
    expect(html).toContain("Years of Agricultural Excellence");
    expect(html).toContain("Available formats");
    expect(html).toContain("Packed for your market");
    expect(html).toContain("Why MDF");
    expect(html).toContain("Request price &amp; specs");
  });

  it("uses the Guntur palette for hero + CTA surfaces", () => {
    const p = getProductTheme("guntur-chilli").palette;
    expect(html).toContain(p.ink); // hero + cta ink surface
    expect(html).toContain(p.primary); // eyebrow tag
    expect(html).toContain(p.accent); // CTA button bg
  });

  it("shows an intentional placeholder when hero image is missing", () => {
    expect(html).toContain("Hero image");
    expect(html).toContain("Awaiting approved production asset");
  });

  it("never uses browser-only critical layout (grid/flex/clip-path/backdrop-blur)", () => {
    expect(html).not.toMatch(/display:\s*grid/i);
    expect(html).not.toMatch(/display:\s*flex/i);
    expect(html).not.toMatch(/clip-path\s*:/i);
    expect(html).not.toMatch(/backdrop-filter/i);
    expect(html).not.toMatch(/backdrop-blur/i);
  });

  it("declares light color-scheme so email clients respect the paper background", () => {
    expect(html).toContain('name="color-scheme" content="light"');
    expect(html).toContain('name="supported-color-schemes"');
  });
});

describe("renderer — Direct composition", () => {
  const template = buildProductTemplate("guntur-chilli", "direct");
  const html = renderEmailHtml({
    template,
    buyer: null,
    settings,
    assetsBySlot: {},
  });

  it("uses the compact procurement composition, not the full Signature chain", () => {
    // Direct includes intro, hero, trust line, footer. It does NOT include
    // formats/packing/why/origin sections at all.
    expect(html).toContain("Guntur Dry Red Chilli — direct from India.");
    // Chip conversion from directPoints — each point becomes its own chip.
    expect(html).toContain("With Stem");
    expect(html).toContain("Stemless");
    expect(html).toContain("Chilli Powder");
    // Compact trust line
    expect(html).toContain("40+");
    // No formats/packing/why headings — those sections are hidden AND
    // not rendered by the direct renderer.
    expect(html).not.toContain("Available formats");
    expect(html).not.toContain("Packed for your market");
    expect(html).not.toContain("Why MDF");
    expect(html).not.toContain("India's most important dry red chilli region");
  });

  it("renders the CTA as a real HTML button with real label", () => {
    expect(html).toContain("Request price &amp; specs");
    expect(html).toMatch(/<a href="[^"]*"[^>]*>Request price &amp; specs<\/a>/);
  });
});

describe("renderer — dark-mode CSS never cascades into inner tables (regression)", () => {
  // The 'white blocks around CTA button' bug was caused by a `body, table
  // { background-color: X !important }` rule inside the dark-mode media
  // block: it cascaded to every nested <table> including the CTA button.
  // Guard against any future broad `table` selector with !important
  // background inside a media block.
  const template = buildProductTemplate("guntur-chilli", "signature");
  const html = renderEmailHtml({
    template,
    buyer: null,
    settings,
    assetsBySlot: {},
  });
  it("does not apply background-color !important to the bare table selector", () => {
    // No `table {` / `table,` selector followed by an important background.
    expect(html).not.toMatch(/\btable\s*\{[^}]*background-color[^}]*!important/i);
    expect(html).not.toMatch(/\btable\s*,[^{]*\{[^}]*background-color[^}]*!important/i);
    expect(html).not.toMatch(/,\s*table\s*\{[^}]*background-color[^}]*!important/i);
  });
});

describe("renderer — surface backgrounds paint reliably (regression)", () => {
  // The Mango Direct pale-on-pale bug was caused by border-radius +
  // overflow:hidden on a <table> preventing the dark hero background
  // from painting. Guard against that class of bug — the dark surface
  // colour must appear on both `bgcolor` attribute and inline style.
  const products = [
    { key: "guntur-chilli" as const, dark: "#24110E" },
    { key: "banganapalli-mango" as const, dark: "#173525" },
    { key: "pomegranate" as const, dark: "#261318" },
    { key: "indian-apple" as const, dark: "#132019" },
  ];
  for (const { key, dark } of products) {
    it(`${key} Direct hero paints dark surface via bgcolor attribute`, () => {
      const template = buildProductTemplate(key, "direct");
      const html = renderEmailHtml({
        template,
        buyer: null,
        settings,
        assetsBySlot: {},
      });
      expect(html).toContain(`bgcolor="${dark}"`);
      expect(html).toContain(`background-color:${dark}`);
    });
    it(`${key} Signature hero paints dark surface via bgcolor attribute`, () => {
      const template = buildProductTemplate(key, "signature");
      const html = renderEmailHtml({
        template,
        buyer: null,
        settings,
        assetsBySlot: {},
      });
      expect(html).toContain(`bgcolor="${dark}"`);
      expect(html).toContain(`background-color:${dark}`);
    });
  }
});

describe("renderer — per-product palette differentiation", () => {
  const products = [
    { key: "guntur-chilli" as const, expectedPrimary: "#8F1F18" },
    { key: "banganapalli-mango" as const, expectedPrimary: "#B36F1C" },
    { key: "pomegranate" as const, expectedPrimary: "#A3324B" },
    { key: "indian-apple" as const, expectedPrimary: "#AE3A32" },
  ];
  for (const { key, expectedPrimary } of products) {
    it(`${key} uses its own product palette`, () => {
      const template = buildProductTemplate(key, "signature");
      const html = renderEmailHtml({
        template,
        buyer: null,
        settings,
        assetsBySlot: {},
      });
      expect(html).toContain(expectedPrimary);
    });
  }
});

describe("renderer — personalization", () => {
  it("greeting falls back to 'Hello,' when no buyer is provided (library preview)", () => {
    const template = buildProductTemplate("guntur-chilli", "signature");
    const html = renderEmailHtml({
      template,
      buyer: null,
      settings,
      assetsBySlot: {},
    });
    expect(html).toContain("Hello,");
    // Must not leak the raw token or reveal a fictional buyer name.
    expect(html).not.toContain("{{first_name}}");
    expect(html).not.toContain("{{greeting}}");
  });
});

describe("renderer — plain text preserves the essential information", () => {
  const template = buildProductTemplate("guntur-chilli", "signature");
  const text = renderEmailText({
    template,
    buyer: null,
    settings,
    assetsBySlot: {},
  });
  it("mentions the product, the formats, the 40+ trust line, and the CTA", () => {
    expect(text).toContain("Guntur");
    expect(text).toContain("Available formats");
    expect(text).toContain("With Stem");
    expect(text).toContain("Stemless");
    expect(text).toContain("40+ Years of Agricultural Excellence");
    // Plain text does not HTML-escape the &.
    expect(text).toContain("Request price & specs");
  });
});
