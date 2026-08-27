import { describe, it, expect } from "vitest";
import { renderEmailHtml } from "./renderer";
import type { AssetRecord, EmailTemplate, WorkspaceSettings } from "@/lib/types";

/**
 * Phase F1 follow-up: renderDirect() must honour EmailSection.visible.
 * The composer exposes an Eye toggle for every section including
 * Direct's intro / hero / cta — the delivered email must agree.
 */

const SETTINGS: WorkspaceSettings = {
  id: "singleton",
  company: { companyName: "MDF", shortName: "", tagline: "", heritage: "", location: "", website: "", email: "" },
  brand: { orange: "", charcoal: "", ivory: "", chilli: "" },
  email: {
    fromName: "MDF",
    replyTo: "",
    websiteUrl: "",
    whatsappUrl: "",
    linkedinUrl: "",
    instagramUrl: "",
    defaultCtaUrl: "",
    defaultSubject: "",
    defaultPreheader: "",
  },
  onboardingComplete: true,
  createdAt: "x",
  updatedAt: "x",
};

function tpl(overrides: Partial<Record<"intro" | "hero" | "cta", boolean>>): EmailTemplate {
  const v = (t: "intro" | "hero" | "cta") => overrides[t] !== false; // default visible
  return {
    id: "t1",
    name: "T",
    themeKey: "guntur-chilli",
    variant: "direct",
    version: 1,
    status: "approved",
    createdAt: "x",
    updatedAt: "x",
    sections: [
      {
        id: "sec-intro",
        type: "intro",
        visible: v("intro"),
        data: { greeting: "INTRO_GREETING_MARK", body: "" },
      },
      {
        id: "sec-hero",
        type: "hero",
        visible: v("hero"),
        data: { headline: "HERO_HEADLINE_MARK", body: "line 1\nline 2", ctaLabel: "HERO_CTA_MARK", ctaUrl: "https://a" },
      },
      {
        id: "sec-cta",
        type: "cta",
        visible: v("cta"),
        data: { ctaLabel: "CTA_CTA_MARK", ctaUrl: "https://b" },
      },
    ],
  };
}

const assetsBySlot: Record<string, AssetRecord | undefined> = {};

describe("renderDirect — visibility honoured", () => {
  it("all three visible → opening + hero band + CTA button all render", () => {
    const html = renderEmailHtml({
      template: tpl({}),
      buyer: null,
      settings: SETTINGS,
      assetsBySlot,
      campaign: { preheader: "" },
    });
    expect(html).toContain("INTRO_GREETING_MARK");
    expect(html).toContain("HERO_HEADLINE_MARK");
    // CTA label prefers cta section over hero when both are visible.
    expect(html).toContain("CTA_CTA_MARK");
  });

  it("intro hidden → opening band omitted (greeting mark not in output)", () => {
    const html = renderEmailHtml({
      template: tpl({ intro: false }),
      buyer: null,
      settings: SETTINGS,
      assetsBySlot,
      campaign: { preheader: "" },
    });
    expect(html).not.toContain("INTRO_GREETING_MARK");
    // Hero + footer + trust band still render.
    expect(html).toContain("HERO_HEADLINE_MARK");
  });

  it("hero hidden → hero band omitted entirely (headline + CTA gone)", () => {
    const html = renderEmailHtml({
      template: tpl({ hero: false }),
      buyer: null,
      settings: SETTINGS,
      assetsBySlot,
      campaign: { preheader: "" },
    });
    expect(html).not.toContain("HERO_HEADLINE_MARK");
    expect(html).not.toContain("HERO_CTA_MARK");
    // With hero hidden, no host section for the CTA button — CTA_CTA_MARK
    // also disappears because the button lives inside the hero card.
    expect(html).not.toContain("CTA_CTA_MARK");
  });

  it("cta hidden → CTA button falls back to hero.data.ctaLabel (still explicit)", () => {
    const html = renderEmailHtml({
      template: tpl({ cta: false }),
      buyer: null,
      settings: SETTINGS,
      assetsBySlot,
      campaign: { preheader: "" },
    });
    // Hero remains visible so its explicit ctaLabel is used.
    expect(html).toContain("HERO_CTA_MARK");
    // The dedicated cta-section label is NOT rendered.
    expect(html).not.toContain("CTA_CTA_MARK");
  });

  it("cta AND hero.ctaLabel both empty → no CTA button rendered", () => {
    const template = tpl({});
    template.sections = template.sections.map((s) => {
      if (s.type === "hero") return { ...s, data: { ...s.data, ctaLabel: "" } };
      if (s.type === "cta") return { ...s, visible: false };
      return s;
    });
    const html = renderEmailHtml({
      template,
      buyer: null,
      settings: SETTINGS,
      assetsBySlot,
      campaign: { preheader: "" },
    });
    // No CTA_CTA_MARK (cta hidden) and no HERO_CTA_MARK (ctaLabel wiped).
    expect(html).not.toContain("HERO_CTA_MARK");
    expect(html).not.toContain("CTA_CTA_MARK");
    // And no hardcoded "Request price & specs" fallback.
    expect(html).not.toContain("Request price &amp; specs");
    expect(html).not.toContain("Request price & specs");
  });
});
