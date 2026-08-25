export type BuyerStatus =
  | "new"
  | "qualified"
  | "ready"
  | "contacted"
  | "replied"
  | "interested"
  | "quotation-sent"
  | "negotiating"
  | "converted"
  | "not-interested";

export const BUYER_STATUS_ORDER: BuyerStatus[] = [
  "new",
  "qualified",
  "ready",
  "contacted",
  "replied",
  "interested",
  "quotation-sent",
  "negotiating",
  "converted",
  "not-interested",
];

export const BUYER_STATUS_LABELS: Record<BuyerStatus, string> = {
  new: "New",
  qualified: "Qualified",
  ready: "Ready to Contact",
  contacted: "Contacted",
  replied: "Replied",
  interested: "Interested",
  "quotation-sent": "Quotation Sent",
  negotiating: "Negotiating",
  converted: "Converted",
  "not-interested": "Not Interested",
};

export interface Buyer {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone?: string;
  whatsapp?: string;
  website?: string;
  country: string;
  city?: string;
  buyerType?: string;
  productInterest?: string;
  source?: string;
  notes?: string;
  status: BuyerStatus;
  lastContactedAt?: string;
  nextFollowUpAt?: string;
  createdAt: string;
  updatedAt: string;
  isDemo?: boolean;
}

export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export interface Campaign {
  id: string;
  name: string;
  country: string;
  product: string;
  description?: string;
  templateId: string;
  status: CampaignStatus;
  subject: string;
  preheader: string;
  fromName: string;
  replyTo?: string;
  createdAt: string;
  updatedAt: string;
  isDemo?: boolean;
  /** Product theme this campaign belongs to (used to gate compatible templates). */
  themeKey?: string;
  /** Which variant of the master template this campaign started from. */
  templateVariant?: TemplateVariant;
  /**
   * Campaign-specific snapshot of email sections. When present, the renderer
   * uses these instead of loading from the master template. Editing a
   * campaign's email mutates only this snapshot — the shared master is
   * always left untouched.
   */
  emailSections?: EmailSection[];
}

export interface CampaignRecipient {
  id: string;
  campaignId: string;
  buyerId: string;
  status: BuyerStatus;
  preparedAt?: string;
  simulatedSentAt?: string;
  createdAt: string;
}

export type EmailSectionType =
  | "intro"
  | "hero"
  | "heritage"
  | "origin"
  | "formats"
  | "packing"
  | "why"
  | "cta"
  | "footer";

export interface EmailSection {
  id: string;
  type: EmailSectionType;
  visible: boolean;
  data: Record<string, string>;
}

export type TemplateStatus = "draft" | "approved" | "archived";
export type TemplateVariant = "signature" | "direct";

export interface EmailTemplate {
  id: string;
  name: string;
  label?: string;
  sections: EmailSection[];
  createdAt: string;
  updatedAt: string;
  isDemo?: boolean;
  /** Product theme key from the ProductTheme registry (optional for legacy). */
  themeKey?: string;
  /** Template variant — controls section rhythm / renderer choice. */
  variant?: TemplateVariant;
  /** Semantic version for the frozen production content. */
  version?: number;
  /** Lifecycle status. Only approved templates should eventually be sent live. */
  status?: TemplateStatus;
}

export type AssetSlot =
  | "logo"
  | "hero"
  | "stem"
  | "stemless"
  | "powder"
  | "packing"
  | "origin";

export interface AssetRecord {
  id: string;
  slot: AssetSlot;
  name: string;
  productionUrl?: string;
  localDataUrl?: string;
  updatedAt: string;
}

export interface CompanySettings {
  companyName: string;
  shortName: string;
  tagline: string;
  heritage: string;
  location: string;
  website: string;
  email: string;
}

export interface BrandSettings {
  orange: string;
  charcoal: string;
  ivory: string;
  chilli: string;
}

export interface EmailDefaults {
  fromName: string;
  replyTo: string;
  websiteUrl: string;
  whatsappUrl: string;
  linkedinUrl: string;
  instagramUrl: string;
  defaultCtaUrl: string;
  defaultSubject: string;
  defaultPreheader: string;
}

export interface WorkspaceSettings {
  id: "singleton";
  company: CompanySettings;
  brand: BrandSettings;
  email: EmailDefaults;
  onboardingComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEvent {
  id: string;
  at: string;
  kind: string;
  message: string;
  entity?: { type: string; id: string };
}

export interface WorkspaceBackup {
  version: 1;
  exportedAt: string;
  workspace: {
    buyers: Buyer[];
    campaigns: Campaign[];
    recipients: CampaignRecipient[];
    templates: EmailTemplate[];
    assets: AssetRecord[];
    activity: ActivityEvent[];
    settings: WorkspaceSettings | null;
  };
}
