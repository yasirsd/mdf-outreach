import { describe, it, expect } from "vitest";
import { renderEmailHtml } from "./renderer";
import type { AssetRecord, Buyer, EmailTemplate, WorkspaceSettings } from "@/lib/types";

/**
 * Phase F1 follow-up — the preheader contract for REAL CAMPAIGNS is
 * "snapshot-owned": whatever the campaign stores is rendered verbatim,
 * empty means intentionally no preheader, and later Settings edits
 * cannot alter an existing campaign's delivered email.
 *
 * The template-library preview (no campaign context) may still consult
 * settings.email.defaultPreheader for demonstration purposes.
 */

const SETTINGS: WorkspaceSettings = {
  id: "singleton",
  company: {
    companyName: "MDF",
    shortName: "",
    tagline: "",
    heritage: "",
    location: "",
    website: "",
    email: "",
  },
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
    defaultPreheader: "SETTINGS DEFAULT PREHEADER",
  },
  onboardingComplete: true,
  createdAt: "x",
  updatedAt: "x",
};

const TEMPLATE: EmailTemplate = {
  id: "t1",
  name: "T",
  sections: [
    { id: "s1", type: "intro", visible: true, data: { greeting: "Hi {{first_name}}" } },
  ],
  themeKey: "guntur-chilli",
  variant: "signature",
  version: 1,
  status: "approved",
  createdAt: "x",
  updatedAt: "x",
};

const BUYER: Buyer = {
  id: "b1",
  firstName: "Aroon",
  lastName: "K",
  company: "Aroon Foods",
  email: "a@example.com",
  country: "Thailand",
  status: "ready",
  createdAt: "x",
  updatedAt: "x",
};

const assetsBySlot: Record<string, AssetRecord | undefined> = {};

function extractPreheader(html: string): string {
  const m = html.match(/<div style="display:none;[^"]*">([\s\S]*?)<\/div>/);
  return m ? m[1].trim() : "";
}

function hasPreheaderElement(html: string): boolean {
  return html.includes('style="display:none;overflow:hidden');
}

describe("renderEmailHtml — snapshot-owned preheader for real campaigns", () => {
  it("renders exactly the campaign's own preheader (no fallback to Settings)", () => {
    const html = renderEmailHtml({
      template: TEMPLATE,
      buyer: BUYER,
      settings: SETTINGS,
      assetsBySlot,
      campaign: { preheader: "CAMPAIGN PREHEADER" },
    });
    expect(extractPreheader(html)).toBe("CAMPAIGN PREHEADER");
  });

  it("empty campaign preheader renders NO preheader element (settings is NOT a runtime fallback)", () => {
    const html = renderEmailHtml({
      template: TEMPLATE,
      buyer: BUYER,
      settings: SETTINGS,
      assetsBySlot,
      campaign: { preheader: "" },
    });
    expect(hasPreheaderElement(html)).toBe(false);
  });

  it("whitespace-only campaign preheader renders NO preheader element", () => {
    const html = renderEmailHtml({
      template: TEMPLATE,
      buyer: BUYER,
      settings: SETTINGS,
      assetsBySlot,
      campaign: { preheader: "   " },
    });
    expect(hasPreheaderElement(html)).toBe(false);
  });

  it("changing Settings default cannot alter an existing campaign's render", () => {
    const campaignA = { preheader: "Locked-in preheader" };

    const beforeSettingsChange = renderEmailHtml({
      template: TEMPLATE,
      buyer: BUYER,
      settings: SETTINGS,
      assetsBySlot,
      campaign: campaignA,
    });

    const afterSettingsChange = renderEmailHtml({
      template: TEMPLATE,
      buyer: BUYER,
      settings: {
        ...SETTINGS,
        email: { ...SETTINGS.email, defaultPreheader: "TOTALLY DIFFERENT DEFAULT" },
      },
      assetsBySlot,
      campaign: campaignA,
    });

    expect(extractPreheader(beforeSettingsChange)).toBe("Locked-in preheader");
    expect(extractPreheader(afterSettingsChange)).toBe("Locked-in preheader");
  });

  it("personalizes {{first_name}} inside the campaign preheader", () => {
    const html = renderEmailHtml({
      template: TEMPLATE,
      buyer: BUYER,
      settings: SETTINGS,
      assetsBySlot,
      campaign: { preheader: "Hi {{first_name}} — inside" },
    });
    expect(extractPreheader(html)).toBe("Hi Aroon — inside");
  });
});

describe("renderEmailHtml — Template Library preview (no campaign)", () => {
  it("no campaign argument uses Settings default (allowed here — demo path)", () => {
    const html = renderEmailHtml({
      template: TEMPLATE,
      buyer: BUYER,
      settings: SETTINGS,
      assetsBySlot,
    });
    expect(extractPreheader(html)).toBe("SETTINGS DEFAULT PREHEADER");
  });

  it("no campaign + empty Settings default ⇒ no preheader element", () => {
    const html = renderEmailHtml({
      template: TEMPLATE,
      buyer: BUYER,
      settings: { ...SETTINGS, email: { ...SETTINGS.email, defaultPreheader: "" } },
      assetsBySlot,
    });
    expect(hasPreheaderElement(html)).toBe(false);
  });
});
