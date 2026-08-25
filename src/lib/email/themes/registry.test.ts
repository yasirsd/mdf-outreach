import { describe, it, expect } from "vitest";
import { PRODUCT_KEYS } from "./types";
import { PRODUCT_THEMES, getProductTheme } from "./registry";
import { allProductionTemplates, buildProductTemplate } from "@/lib/email/templates/build";

describe("ProductTheme registry", () => {
  it("has an entry for every declared product key", () => {
    for (const key of PRODUCT_KEYS) {
      const theme = getProductTheme(key);
      expect(theme.key).toBe(key);
      expect(theme.name.length).toBeGreaterThan(0);
      expect(theme.palette.ink).toMatch(/^#[0-9A-F]{6}$/i);
      expect(theme.palette.paper).toMatch(/^#[0-9A-F]{6}$/i);
      expect(theme.palette.primary).toMatch(/^#[0-9A-F]{6}$/i);
      expect(theme.palette.accent).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("does not invent product certifications or claims in copy", () => {
    const forbidden = [
      /ISO ?\d/i,
      /USDA/,
      /HACCP/,
      /organic certified/i,
      /world['’]s (?:best|largest|top)/i,
      /number[- ]one/i,
      /guarantee/i,
      /\bshu\b/i, // SHU / heat spec numbers should not be baked into copy
      /\basta\b/i,
      /pesticide/i,
    ];
    for (const theme of Object.values(PRODUCT_THEMES)) {
      const bag = JSON.stringify(theme.copy).toLowerCase();
      for (const pattern of forbidden) {
        expect(bag).not.toMatch(pattern);
      }
    }
  });

  it("mentions the 40+ years / 1984 heritage line for every product", () => {
    for (const theme of Object.values(PRODUCT_THEMES)) {
      const bag = JSON.stringify(theme.copy);
      expect(/(40\+|1984|four decades)/i.test(bag)).toBe(true);
    }
  });
});

describe("Production template factory", () => {
  it("emits exactly 8 templates in deterministic order", () => {
    const all = allProductionTemplates();
    expect(all).toHaveLength(8);
    const keys = all.map((t) => `${t.themeKey}:${t.variant}`);
    expect(keys).toEqual([
      "guntur-chilli:signature",
      "guntur-chilli:direct",
      "banganapalli-mango:signature",
      "banganapalli-mango:direct",
      "pomegranate:signature",
      "pomegranate:direct",
      "indian-apple:signature",
      "indian-apple:direct",
    ]);
  });

  it("marks all production templates as approved v1", () => {
    for (const t of allProductionTemplates()) {
      expect(t.status).toBe("approved");
      expect(t.version).toBe(1);
      expect(t.isDemo).toBe(false);
    }
  });

  it("signature templates keep the storytelling sections visible", () => {
    const t = buildProductTemplate("guntur-chilli", "signature");
    const visibleTypes = t.sections.filter((s) => s.visible).map((s) => s.type);
    expect(visibleTypes).toContain("intro");
    expect(visibleTypes).toContain("hero");
    expect(visibleTypes).toContain("heritage");
    expect(visibleTypes).toContain("formats");
    expect(visibleTypes).toContain("packing");
    expect(visibleTypes).toContain("why");
    expect(visibleTypes).toContain("cta");
    expect(visibleTypes).toContain("footer");
  });

  it("direct templates hide storytelling and keep only intro/hero/cta/footer visible", () => {
    const t = buildProductTemplate("guntur-chilli", "direct");
    const visibleTypes = t.sections.filter((s) => s.visible).map((s) => s.type).sort();
    expect(visibleTypes).toEqual(["cta", "footer", "hero", "intro"]);
  });

  it("every section has a stable id", () => {
    for (const t of allProductionTemplates()) {
      const ids = new Set(t.sections.map((s) => s.id));
      expect(ids.size).toBe(t.sections.length);
    }
  });
});
