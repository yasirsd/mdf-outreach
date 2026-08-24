import type {
  ActivityEvent,
  AssetRecord,
  Buyer,
  Campaign,
  CampaignRecipient,
  EmailTemplate,
  WorkspaceSettings,
} from "@/lib/types";
import { createDefaultTemplate, DEFAULT_TEMPLATE_ID } from "@/lib/email/defaultTemplate";

export const DEMO_CAMPAIGN_ID = "cmp-thailand-guntur";

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultSettings(): WorkspaceSettings {
  const now = new Date().toISOString();
  return {
    id: "singleton",
    onboardingComplete: false,
    createdAt: now,
    updatedAt: now,
    company: {
      companyName: "MDF Exports & Imports",
      shortName: "MDF",
      tagline: "Exporting India's Freshness to the World.",
      heritage: "MD Fruits · Since 1984",
      location: "Ongole, Andhra Pradesh, India",
      website: "https://www.mdfexport.com",
      email: "contact@mdfexport.com",
    },
    brand: {
      orange: "#F36B21",
      charcoal: "#151515",
      ivory: "#FAF8F4",
      chilli: "#A62921",
    },
    email: {
      fromName: "MDF Exports & Imports",
      replyTo: "contact@mdfexport.com",
      websiteUrl: "https://www.mdfexport.com",
      whatsappUrl: "",
      linkedinUrl: "",
      instagramUrl: "",
      defaultCtaUrl: "https://www.mdfexport.com/enquire",
      defaultSubject: "Guntur Dry Red Chilli Supply from India — MDF Exports",
      defaultPreheader:
        "Stem, stemless & powder formats. Custom packing. Direct from Andhra Pradesh.",
    },
  };
}

export function createDemoBuyers(): Buyer[] {
  const now = new Date().toISOString();
  const base: Array<Omit<Buyer, "id" | "createdAt" | "updatedAt" | "status" | "isDemo"> & { status?: Buyer["status"] }> = [
    {
      firstName: "Somchai",
      lastName: "Prasert",
      company: "Siam Spice Trading Co., Ltd.",
      email: "somchai@example.com",
      phone: "+66 2 555 0110",
      whatsapp: "+66 81 555 0110",
      website: "https://example.com/siam-spice",
      country: "Thailand",
      city: "Bangkok",
      buyerType: "Importer",
      productInterest: "Dry Red Chilli",
      source: "Trade directory",
      notes: "Requested pricing for 20ft container of stemless.",
      status: "ready",
    },
    {
      firstName: "Nattapong",
      lastName: "Chaiyawat",
      company: "Bangkok Foods International",
      email: "n.chaiyawat@example.com",
      phone: "+66 2 555 0234",
      country: "Thailand",
      city: "Bangkok",
      buyerType: "Food Manufacturer",
      productInterest: "Chilli Powder",
      source: "LinkedIn",
      status: "qualified",
    },
    {
      firstName: "Pranee",
      lastName: "Suksawat",
      company: "Chao Phraya Ingredients",
      email: "pranee@example.com",
      phone: "+66 2 555 0301",
      country: "Thailand",
      city: "Nonthaburi",
      buyerType: "Distributor",
      productInterest: "Dry Red Chilli with Stem",
      source: "Referral",
      status: "contacted",
    },
    {
      firstName: "Anurak",
      lastName: "Wongchai",
      company: "Northern Spice Co.",
      email: "anurak@example.com",
      country: "Thailand",
      city: "Chiang Mai",
      buyerType: "Wholesaler",
      productInterest: "Chilli Powder",
      source: "Trade fair",
      status: "new",
    },
    {
      firstName: "Malee",
      lastName: "Tanaka",
      company: "Golden Basil Foods",
      email: "malee@example.com",
      phone: "+66 2 555 0455",
      country: "Thailand",
      city: "Bangkok",
      buyerType: "Retail Procurement",
      productInterest: "Stemless Dry Red Chilli",
      source: "Web enquiry",
      status: "interested",
      notes: "Wants private label pouches for retail.",
    },
    {
      firstName: "Kritsada",
      lastName: "Boonmee",
      company: "Thai Curry House",
      email: "kritsada@example.com",
      country: "Thailand",
      city: "Phuket",
      buyerType: "Private Label",
      productInterest: "Chilli Powder",
      source: "Instagram",
      status: "qualified",
    },
    {
      firstName: "Chalerm",
      lastName: "Sirinat",
      company: "Isaan Spice Exchange",
      email: "chalerm@example.com",
      phone: "+66 2 555 0620",
      country: "Thailand",
      city: "Udon Thani",
      buyerType: "Wholesaler",
      productInterest: "Dry Red Chilli",
      source: "Trade directory",
      status: "ready",
    },
    {
      firstName: "Ratana",
      lastName: "Pichai",
      company: "Krung Thep Ingredients",
      email: "ratana@example.com",
      country: "Thailand",
      city: "Bangkok",
      buyerType: "Food Manufacturer",
      productInterest: "Chilli Powder",
      source: "Web enquiry",
      status: "replied",
      notes: "Asked for MOQ and shipping timeline.",
    },
    {
      firstName: "Wichai",
      lastName: "Ruangroj",
      company: "Southeast Asian Foods Group",
      email: "wichai@example.com",
      phone: "+66 2 555 0888",
      country: "Thailand",
      city: "Bangkok",
      buyerType: "Distributor",
      productInterest: "Stem, Stemless, Powder",
      source: "Referral",
      status: "quotation-sent",
    },
  ];
  return base.map((b) => ({
    ...b,
    id: uid("buy"),
    status: b.status ?? "new",
    createdAt: now,
    updatedAt: now,
    isDemo: true,
  }));
}

export function createDemoCampaign(templateId: string, settings: WorkspaceSettings): Campaign {
  const now = new Date().toISOString();
  return {
    id: DEMO_CAMPAIGN_ID,
    name: "Thailand — Guntur Chilli",
    country: "Thailand",
    product: "Guntur Dry Red Chilli",
    description: "Introductory outreach to Thailand spice importers.",
    templateId,
    status: "active",
    subject: settings.email.defaultSubject,
    preheader: settings.email.defaultPreheader,
    fromName: settings.email.fromName,
    replyTo: settings.email.replyTo,
    createdAt: now,
    updatedAt: now,
    isDemo: true,
  };
}

export function createDemoRecipients(campaignId: string, buyers: Buyer[]): CampaignRecipient[] {
  const now = new Date().toISOString();
  return buyers.map((b) => ({
    id: uid("rcp"),
    campaignId,
    buyerId: b.id,
    status: b.status,
    createdAt: now,
  }));
}

export function createDemoAssets(): AssetRecord[] {
  const now = new Date().toISOString();
  const slots: AssetRecord["slot"][] = ["logo", "hero", "stem", "stemless", "powder", "packing", "origin"];
  return slots.map((slot) => ({
    id: `asset-${slot}`,
    slot,
    name: `${slot} placeholder`,
    productionUrl: "",
    localDataUrl: "",
    updatedAt: now,
  }));
}

export function createDemoActivity(buyers: Buyer[]): ActivityEvent[] {
  const now = Date.now();
  const events: ActivityEvent[] = [
    {
      id: uid("act"),
      at: new Date(now - 1000 * 60 * 12).toISOString(),
      kind: "buyer.added",
      message: `${buyers[0].firstName} ${buyers[0].lastName} added`,
      entity: { type: "buyer", id: buyers[0].id },
    },
    {
      id: uid("act"),
      at: new Date(now - 1000 * 60 * 40).toISOString(),
      kind: "email.prepared",
      message: `Email prepared for ${buyers[2].company}`,
      entity: { type: "buyer", id: buyers[2].id },
    },
    {
      id: uid("act"),
      at: new Date(now - 1000 * 60 * 60 * 3).toISOString(),
      kind: "buyer.status",
      message: `${buyers[4].company} marked as Interested`,
      entity: { type: "buyer", id: buyers[4].id },
    },
    {
      id: uid("act"),
      at: new Date(now - 1000 * 60 * 60 * 22).toISOString(),
      kind: "campaign.updated",
      message: "Thailand — Guntur Chilli campaign updated",
    },
  ];
  return events;
}

export interface DemoWorkspace {
  buyers: Buyer[];
  template: EmailTemplate;
  campaign: Campaign;
  recipients: CampaignRecipient[];
  assets: AssetRecord[];
  activity: ActivityEvent[];
  settings: WorkspaceSettings;
}

export function buildDemoWorkspace(): DemoWorkspace {
  const settings = { ...createDefaultSettings(), onboardingComplete: true };
  const template = createDefaultTemplate();
  const buyers = createDemoBuyers();
  const campaign = createDemoCampaign(template.id, settings);
  const recipients = createDemoRecipients(campaign.id, buyers);
  const assets = createDemoAssets();
  const activity = createDemoActivity(buyers);
  return { buyers, template, campaign, recipients, assets, activity, settings };
}

export function buildEmptyWorkspace(): DemoWorkspace {
  const settings = { ...createDefaultSettings(), onboardingComplete: true };
  const template = createDefaultTemplate();
  // Template is not marked demo when starting empty (so user keeps it)
  template.isDemo = false;
  return {
    buyers: [],
    template,
    campaign: {
      id: DEMO_CAMPAIGN_ID,
      name: "Thailand — Guntur Chilli",
      country: "Thailand",
      product: "Guntur Dry Red Chilli",
      description: "Introductory outreach to Thailand spice importers.",
      templateId: template.id,
      status: "draft",
      subject: settings.email.defaultSubject,
      preheader: settings.email.defaultPreheader,
      fromName: settings.email.fromName,
      replyTo: settings.email.replyTo,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    recipients: [],
    assets: createDemoAssets(),
    activity: [],
    settings,
  };
}
