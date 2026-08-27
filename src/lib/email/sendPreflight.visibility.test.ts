import { describe, it, expect } from "vitest";
import { preflightAssetsForSend } from "./sendPreflight";
import type { AssetRecord, Campaign, EmailSection, EmailTemplate } from "@/lib/types";
import { allProductionTemplates } from "./templates/build";

function sec(type: EmailSection["type"], visible: boolean, data: Record<string, string> = {}): EmailSection {
  return { id: `${type}-1`, type, visible, data };
}

function tpl(
  sections: EmailSection[],
  variant: "signature" | "direct" = "signature",
  themeKey: EmailTemplate["themeKey"] = "guntur-chilli",
): EmailTemplate {
  return {
    id: "t1",
    name: "T",
    sections,
    themeKey,
    variant,
    version: 1,
    status: "approved",
    createdAt: "x",
    updatedAt: "x",
  };
}

function productionAsset(slot: string, themeKey: string): AssetRecord {
  return {
    id: `a-${slot}`,
    themeKey,
    slot,
    name: `${slot}.jpg`,
    productionUrl: `https://cdn.example/${slot}.jpg`,
    storagePath: `ws/${themeKey}/${slot}/${slot}.jpg`,
    status: "production",
    altText: `${slot} alt`,
    isDecorative: false,
    updatedAt: "x",
  };
}

describe("preflightAssetsForSend — visibility respected", () => {
  it("hidden hero + missing hero asset ⇒ PASS (hero is not rendered)", () => {
    const template = tpl([sec("intro", true), sec("hero", false), sec("cta", true)]);
    const findings = preflightAssetsForSend(template, {});
    expect(findings).toEqual([]);
  });

  it("visible hero + missing hero asset ⇒ BLOCK", () => {
    const template = tpl([sec("hero", true)]);
    const findings = preflightAssetsForSend(template, {});
    expect(findings.some((f) => f.slot === "hero" && f.reason === "missing")).toBe(true);
  });

  it("hidden origin + missing origin asset ⇒ PASS", () => {
    const template = tpl([sec("hero", true), sec("origin", false)]);
    const findings = preflightAssetsForSend(template, {
      hero: productionAsset("hero", "guntur-chilli"),
    });
    expect(findings).toEqual([]);
  });

  it("visible origin + missing origin asset ⇒ BLOCK", () => {
    const template = tpl([sec("hero", true), sec("origin", true)]);
    const findings = preflightAssetsForSend(template, {
      hero: productionAsset("hero", "guntur-chilli"),
    });
    expect(findings.some((f) => f.slot === "origin")).toBe(true);
  });

  it("hidden formats + missing per-format imagery ⇒ PASS", () => {
    const template = tpl([sec("hero", true), sec("formats", false)]);
    const findings = preflightAssetsForSend(template, {
      hero: productionAsset("hero", "guntur-chilli"),
    });
    expect(findings).toEqual([]);
  });

  it("visible formats does not add per-format required slots (fallback + placeholder is intentional)", () => {
    const template = tpl([sec("hero", true), sec("formats", true)]);
    const findings = preflightAssetsForSend(template, {
      hero: productionAsset("hero", "guntur-chilli"),
    });
    expect(findings).toEqual([]);
  });

  it("decorative slots (texture / divider / doodle) never appear as blockers", () => {
    // Even if we pretend the mapping listed them, the strip pass drops them.
    const template = tpl([sec("hero", true)]);
    const findings = preflightAssetsForSend(template, {
      hero: productionAsset("hero", "guntur-chilli"),
    });
    for (const f of findings) {
      expect(["texture", "divider", "doodle"]).not.toContain(f.slot);
    }
  });

  it("campaign snapshot with hidden hero wins over master with visible hero", () => {
    const master = tpl([sec("hero", true)]);
    const campaign: Partial<Campaign> = {
      emailSections: [sec("hero", false), sec("intro", true)],
      templateVariant: "signature",
    };
    const findings = preflightAssetsForSend(master, {}, campaign as Campaign);
    expect(findings).toEqual([]);
  });
});

describe("preflightAssetsForSend — Direct variant", () => {
  it("Direct with visible hero requires hero", () => {
    const template = tpl([sec("intro", true), sec("hero", true), sec("cta", true)], "direct");
    const findings = preflightAssetsForSend(template, {});
    expect(findings.some((f) => f.slot === "hero")).toBe(true);
  });

  it("Direct with hero HIDDEN does NOT require hero", () => {
    const template = tpl(
      [sec("intro", true), sec("hero", false), sec("cta", true)],
      "direct",
    );
    const findings = preflightAssetsForSend(template, {});
    expect(findings).toEqual([]);
  });

  it("Direct never requires origin / packing regardless of section content", () => {
    const template = tpl(
      [sec("hero", true), sec("origin", true), sec("packing", true)],
      "direct",
    );
    const findings = preflightAssetsForSend(template, {
      hero: productionAsset("hero", "guntur-chilli"),
    });
    // Only hero can appear; origin/packing must not.
    for (const f of findings) expect(f.slot).toBe("hero");
    expect(findings).toEqual([]);
  });
});

describe("preflightAssetsForSend — all 8 masters × hidden hero", () => {
  // Every master template with Hero hidden must PASS the hero
  // requirement. Both Signature and Direct honour visibility after the
  // F1 follow-up.
  for (const master of allProductionTemplates()) {
    const label = `${master.name}`;
    it(`${label}: hero hidden ⇒ no hero blocker (visibility respected in both variants)`, () => {
      const withHiddenHero: EmailTemplate = {
        ...master,
        sections: master.sections.map((s) => (s.type === "hero" ? { ...s, visible: false } : s)),
      };
      const findings = preflightAssetsForSend(withHiddenHero, {});
      expect(findings.some((f) => f.slot === "hero")).toBe(false);
    });

    it(`${label}: hero visible + hero asset missing ⇒ blocks`, () => {
      const findings = preflightAssetsForSend(master, {});
      // Every approved master has a visible hero.
      const heroSection = master.sections.find((s) => s.type === "hero");
      if (heroSection?.visible !== false) {
        expect(findings.some((f) => f.slot === "hero")).toBe(true);
      }
    });
  }
});
