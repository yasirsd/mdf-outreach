import { describe, it, expect } from "vitest";
import { effectiveSections } from "./effectiveSections";
import type { Campaign, EmailSection, EmailTemplate } from "@/lib/types";

function sec(
  type: EmailSection["type"],
  visible: boolean,
  data: Record<string, string> = {},
): EmailSection {
  return { id: `${type}-1`, type, visible, data };
}

function tpl(sections: EmailSection[], variant: "signature" | "direct" = "signature"): EmailTemplate {
  return {
    id: "t1",
    name: "T",
    sections,
    themeKey: "guntur-chilli",
    variant,
    version: 1,
    status: "approved",
    createdAt: "x",
    updatedAt: "x",
  };
}

describe("effectiveSections — Signature", () => {
  it("returns only visible sections", () => {
    const t = tpl([sec("intro", true), sec("hero", false), sec("cta", true)]);
    const { variant, sections } = effectiveSections(t);
    expect(variant).toBe("signature");
    expect(sections.map((s) => s.type)).toEqual(["intro", "cta"]);
  });

  it("prefers campaign.emailSections snapshot over master template.sections", () => {
    const t = tpl([sec("hero", true)]);
    const campaign: Partial<Campaign> = {
      emailSections: [sec("hero", false), sec("origin", true)],
      templateVariant: "signature",
    };
    const { sections } = effectiveSections(t, campaign as Campaign);
    // hero hidden in the snapshot must not appear; origin visible must appear
    expect(sections.map((s) => s.type)).toEqual(["origin"]);
  });

  it("falls back to master when campaign.emailSections is empty/absent", () => {
    const t = tpl([sec("hero", true)]);
    const { sections } = effectiveSections(t, { emailSections: [] } as unknown as Campaign);
    expect(sections.map((s) => s.type)).toEqual(["hero"]);
  });
});

describe("effectiveSections — Direct", () => {
  it("selects only VISIBLE intro / hero / cta (visibility honoured after F1 follow-up)", () => {
    const t = tpl(
      [
        sec("intro", false), // hidden ⇒ omitted
        sec("hero", true),
        sec("packing", true), // never picked by Direct regardless
        sec("cta", true),
      ],
      "direct",
    );
    const { variant, sections } = effectiveSections(t);
    expect(variant).toBe("direct");
    expect(sections.map((s) => s.type)).toEqual(["hero", "cta"]);
  });

  it("Direct with hero hidden returns hero-less list", () => {
    const t = tpl(
      [sec("intro", true), sec("hero", false), sec("cta", true)],
      "direct",
    );
    const { sections } = effectiveSections(t);
    expect(sections.map((s) => s.type)).toEqual(["intro", "cta"]);
  });
});

describe("effectiveSections — variant precedence", () => {
  it("campaign.templateVariant overrides template.variant", () => {
    const t = tpl([sec("intro", true), sec("hero", true)], "signature");
    const campaign: Partial<Campaign> = {
      emailSections: [sec("intro", true), sec("hero", true), sec("cta", true)],
      templateVariant: "direct",
    };
    const { variant } = effectiveSections(t, campaign as Campaign);
    expect(variant).toBe("direct");
  });
});
