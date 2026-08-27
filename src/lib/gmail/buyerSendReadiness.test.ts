import { describe, it, expect } from "vitest";
import { classifyRecipients, summarizeReadiness } from "./buyerSendReadiness";
import type {
  AssetRecord,
  Buyer,
  Campaign,
  CampaignRecipient,
  EmailTemplate,
  WorkspaceSettings,
} from "@/lib/types";

const campaign: Campaign = {
  id: "c1",
  name: "Thailand Guntur",
  country: "Thailand",
  product: "Guntur Dry Red Chilli",
  templateId: "t1",
  status: "draft",
  subject: "Guntur — Thai importers",
  preheader: "",
  fromName: "MDF Exports & Imports",
  createdAt: "2026-08-25T00:00:00Z",
  updatedAt: "2026-08-25T00:00:00Z",
};

const template: EmailTemplate = {
  id: "t1",
  name: "MDF Master",
  // Phase F1 preflight derives asset requirements from EFFECTIVELY
  // rendered sections. A visible Hero section is included so the
  // "missing hero" assertions still trigger.
  sections: [
    {
      id: "sec-hero",
      type: "hero",
      visible: true,
      data: { headline: "Guntur" },
    },
  ],
  themeKey: "guntur-chilli",
  variant: "signature",
  version: 1,
  status: "approved",
  createdAt: "2026-08-25T00:00:00Z",
  updatedAt: "2026-08-25T00:00:00Z",
};

const productionHero: AssetRecord = {
  id: "a1",
  themeKey: "guntur-chilli",
  slot: "hero",
  name: "hero.jpg",
  productionUrl: "https://cdn.example/hero.jpg",
  storagePath: "ws/guntur-chilli/hero/hero.jpg",
  status: "production",
  altText: "Guntur hero",
  isDecorative: false,
  updatedAt: "2026-08-25T00:00:00Z",
};

const settings: WorkspaceSettings = {
  id: "singleton",
  company: {
    companyName: "MDF Exports & Imports",
    shortName: "MDF",
    tagline: "",
    heritage: "",
    location: "",
    website: "",
    email: "",
  },
  brand: { orange: "", charcoal: "", ivory: "", chilli: "" },
  email: {
    fromName: "MDF",
    replyTo: "contact@mdfexport.com",
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

function makeBuyer(over: Partial<Buyer> = {}): Buyer {
  return {
    id: "b1",
    firstName: "John",
    lastName: "Tan",
    company: "ABC Foods",
    email: "john@abcfoods.example",
    country: "Thailand",
    status: "ready",
    createdAt: "2026-08-25T00:00:00Z",
    updatedAt: "2026-08-25T00:00:00Z",
    ...over,
  };
}

function makeRecipient(buyerId = "b1"): CampaignRecipient {
  return {
    id: `r-${buyerId}`,
    campaignId: campaign.id,
    buyerId,
    status: "ready",
    createdAt: "2026-08-25T00:00:00Z",
  };
}

describe("classifyRecipients — production Buyer Send readiness", () => {
  it("marks a healthy buyer as READY", () => {
    const [row] = classifyRecipients({
      campaign,
      template,
      settings,
      assets: [productionHero],
      recipients: [makeRecipient()],
      buyers: [makeBuyer()],
      alreadySentBuyerIds: new Set(),
      gmailConnected: true,
    });
    expect(row.status).toBe("ready");
    expect(row.reasons).toEqual([]);
  });

  it("BLOCKS a suppressed buyer (do not contact)", () => {
    const [row] = classifyRecipients({
      campaign,
      template,
      settings,
      assets: [productionHero],
      recipients: [makeRecipient()],
      buyers: [makeBuyer({ suppressed: true, suppressionReason: "manual" })],
      alreadySentBuyerIds: new Set(),
      gmailConnected: true,
    });
    expect(row.status).toBe("blocked");
    expect(row.reasons.some((r) => /Do not contact/i.test(r))).toBe(true);
  });

  it("BLOCKS a buyer with an invalid email address", () => {
    const [row] = classifyRecipients({
      campaign,
      template,
      settings,
      assets: [productionHero],
      recipients: [makeRecipient()],
      buyers: [makeBuyer({ email: "not-an-email" })],
      alreadySentBuyerIds: new Set(),
      gmailConnected: true,
    });
    expect(row.status).toBe("blocked");
    expect(row.reasons.some((r) => /invalid email/i.test(r))).toBe(true);
  });

  it("BLOCKS when Gmail is not connected server-side", () => {
    const [row] = classifyRecipients({
      campaign,
      template,
      settings,
      assets: [productionHero],
      recipients: [makeRecipient()],
      buyers: [makeBuyer()],
      alreadySentBuyerIds: new Set(),
      gmailConnected: false,
    });
    expect(row.status).toBe("blocked");
    expect(row.reasons.some((r) => /Gmail sender/i.test(r))).toBe(true);
  });

  it("BLOCKS when required production assets are missing (no production URL)", () => {
    const [row] = classifyRecipients({
      campaign,
      template,
      settings,
      assets: [], // no hero asset at all
      recipients: [makeRecipient()],
      buyers: [makeBuyer()],
      alreadySentBuyerIds: new Set(),
      gmailConnected: true,
    });
    expect(row.status).toBe("blocked");
    // Preflight message from sendPreflight.ts
    expect(row.reasons.join(" ")).toMatch(/hero|Hero/);
  });

  it("BLOCKS when subject is empty", () => {
    const [row] = classifyRecipients({
      campaign: { ...campaign, subject: "" },
      template,
      settings,
      assets: [productionHero],
      recipients: [makeRecipient()],
      buyers: [makeBuyer()],
      alreadySentBuyerIds: new Set(),
      gmailConnected: true,
    });
    expect(row.status).toBe("blocked");
    expect(row.reasons.some((r) => /Subject is empty/i.test(r))).toBe(true);
  });

  it("BLOCKS when template snapshot is missing", () => {
    const [row] = classifyRecipients({
      campaign,
      template: null,
      settings,
      assets: [productionHero],
      recipients: [makeRecipient()],
      buyers: [makeBuyer()],
      alreadySentBuyerIds: new Set(),
      gmailConnected: true,
    });
    expect(row.status).toBe("blocked");
    expect(row.reasons.some((r) => /template snapshot/i.test(r))).toBe(true);
  });

  it("marks ALREADY-SENT when a successful buyer-send event exists", () => {
    const [row] = classifyRecipients({
      campaign,
      template,
      settings,
      assets: [productionHero],
      recipients: [makeRecipient()],
      buyers: [makeBuyer()],
      alreadySentBuyerIds: new Set(["b1"]),
      gmailConnected: true,
    });
    expect(row.status).toBe("already-sent");
  });

  it("BLOCKS when the buyer's row is missing entirely", () => {
    const [row] = classifyRecipients({
      campaign,
      template,
      settings,
      assets: [productionHero],
      recipients: [makeRecipient()],
      buyers: [], // no matching buyer
      alreadySentBuyerIds: new Set(),
      gmailConnected: true,
    });
    expect(row.status).toBe("blocked");
    expect(row.reasons.some((r) => /no longer exists/i.test(r))).toBe(true);
  });

  it("summarizeReadiness counts each bucket independently", () => {
    const rows = classifyRecipients({
      campaign,
      template,
      settings,
      assets: [productionHero],
      recipients: [makeRecipient("b1"), makeRecipient("b2"), makeRecipient("b3")],
      buyers: [
        makeBuyer({ id: "b1" }),
        makeBuyer({ id: "b2", suppressed: true, suppressionReason: "opted_out" }),
        makeBuyer({ id: "b3" }),
      ],
      alreadySentBuyerIds: new Set(["b3"]),
      gmailConnected: true,
    });
    const s = summarizeReadiness(rows);
    expect(s).toEqual({ ready: 1, blocked: 1, alreadySent: 1, total: 3 });
  });
});
