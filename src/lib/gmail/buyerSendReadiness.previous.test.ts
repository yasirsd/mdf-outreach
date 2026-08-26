import { describe, it, expect } from "vitest";
import { classifyRecipients } from "./buyerSendReadiness";
import type {
  Buyer,
  Campaign,
  CampaignRecipient,
  EmailTemplate,
  WorkspaceSettings,
} from "@/lib/types";

const CAMPAIGN: Campaign = {
  id: "c1",
  name: "Thailand — Guntur",
  country: "Thailand",
  product: "Guntur Dry Red Chilli",
  templateId: "t1",
  status: "draft",
  subject: "Guntur — Thai importers",
  preheader: "",
  fromName: "MDF",
  createdAt: "x",
  updatedAt: "x",
};

const TEMPLATE: EmailTemplate = {
  id: "t1",
  name: "MDF Master",
  sections: [],
  themeKey: "guntur-chilli",
  variant: "signature",
  version: 1,
  status: "approved",
  createdAt: "x",
  updatedAt: "x",
};

const HERO = {
  id: "a1",
  themeKey: "guntur-chilli",
  slot: "hero" as const,
  name: "hero.jpg",
  productionUrl: "https://cdn.example/hero.jpg",
  storagePath: "ws/guntur-chilli/hero/hero.jpg",
  status: "production" as const,
  altText: "Hero",
  isDecorative: false,
  updatedAt: "x",
};

const SETTINGS: WorkspaceSettings = {
  id: "singleton",
  company: {
    companyName: "MDF",
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

function makeBuyer(id: string, over: Partial<Buyer> = {}): Buyer {
  return {
    id,
    firstName: "A",
    lastName: "B",
    company: `Co ${id}`,
    email: `${id}@example.com`,
    country: "Thailand",
    status: "ready",
    createdAt: "x",
    updatedAt: "x",
    ...over,
  };
}

function makeRecipient(id: string): CampaignRecipient {
  return {
    id: `r-${id}`,
    campaignId: CAMPAIGN.id,
    buyerId: id,
    status: "ready",
    createdAt: "x",
  };
}

describe("classifyRecipients — Previous contact column data", () => {
  it("marks previousContactAt=null for buyers never contacted", () => {
    const [row] = classifyRecipients({
      campaign: CAMPAIGN,
      template: TEMPLATE,
      settings: SETTINGS,
      assets: [HERO],
      recipients: [makeRecipient("b1")],
      buyers: [makeBuyer("b1")],
      alreadySentBuyerIds: new Set(),
      gmailConnected: true,
    });
    expect(row.previousContactAt).toBeNull();
    expect(row.previousContactInThisCampaign).toBe(false);
  });

  it("carries the last-successful send timestamp when supplied", () => {
    const map = new Map([["b1", { at: "2026-08-20T10:00:00Z", campaignId: "OTHER" }]]);
    const [row] = classifyRecipients({
      campaign: CAMPAIGN,
      template: TEMPLATE,
      settings: SETTINGS,
      assets: [HERO],
      recipients: [makeRecipient("b1")],
      buyers: [makeBuyer("b1")],
      alreadySentBuyerIds: new Set(),
      gmailConnected: true,
      lastSuccessfulSendByBuyerId: map,
    });
    expect(row.previousContactAt).toBe("2026-08-20T10:00:00Z");
    expect(row.previousContactInThisCampaign).toBe(false);
  });

  it("flags previousContactInThisCampaign when the last successful send was for THIS campaign", () => {
    const map = new Map([["b1", { at: "2026-08-20T10:00:00Z", campaignId: CAMPAIGN.id }]]);
    const [row] = classifyRecipients({
      campaign: CAMPAIGN,
      template: TEMPLATE,
      settings: SETTINGS,
      assets: [HERO],
      recipients: [makeRecipient("b1")],
      buyers: [makeBuyer("b1")],
      alreadySentBuyerIds: new Set(["b1"]),
      gmailConnected: true,
      lastSuccessfulSendByBuyerId: map,
    });
    expect(row.status).toBe("already-sent");
    expect(row.previousContactInThisCampaign).toBe(true);
  });
});
