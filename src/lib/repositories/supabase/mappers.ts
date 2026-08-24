import type {
  ActivityEvent,
  AssetRecord,
  AssetSlot,
  Buyer,
  BuyerStatus,
  Campaign,
  CampaignRecipient,
  CampaignStatus,
  EmailSection,
  EmailTemplate,
  WorkspaceSettings,
} from "@/lib/types";

// Row-level DTOs mirror Supabase's snake_case columns. Kept minimal — only
// fields the app actually reads/writes.

export interface BuyerRow {
  id: string;
  workspace_id: string;
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  country: string;
  city: string | null;
  buyer_type: string | null;
  product_interest: string | null;
  source: string | null;
  notes: string | null;
  status: BuyerStatus;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  created_at: string;
  updated_at: string;
}

export function buyerFromRow(r: BuyerRow): Buyer {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    company: r.company,
    email: r.email,
    phone: r.phone ?? undefined,
    whatsapp: r.whatsapp ?? undefined,
    website: r.website ?? undefined,
    country: r.country,
    city: r.city ?? undefined,
    buyerType: r.buyer_type ?? undefined,
    productInterest: r.product_interest ?? undefined,
    source: r.source ?? undefined,
    notes: r.notes ?? undefined,
    status: r.status,
    lastContactedAt: r.last_contacted_at ?? undefined,
    nextFollowUpAt: r.next_follow_up_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function buyerToRow(
  b: Partial<Buyer>,
  workspaceId: string,
): Omit<BuyerRow, "created_at" | "updated_at"> {
  return {
    id: b.id!,
    workspace_id: workspaceId,
    first_name: b.firstName ?? "",
    last_name: b.lastName ?? "",
    company: b.company ?? "",
    email: b.email ?? "",
    phone: b.phone ?? null,
    whatsapp: b.whatsapp ?? null,
    website: b.website ?? null,
    country: b.country ?? "",
    city: b.city ?? null,
    buyer_type: b.buyerType ?? null,
    product_interest: b.productInterest ?? null,
    source: b.source ?? null,
    notes: b.notes ?? null,
    status: (b.status ?? "new") as BuyerStatus,
    last_contacted_at: b.lastContactedAt ?? null,
    next_follow_up_at: b.nextFollowUpAt ?? null,
  };
}

export interface CampaignRow {
  id: string;
  workspace_id: string;
  name: string;
  country: string;
  product: string;
  description: string | null;
  template_id: string | null;
  status: CampaignStatus;
  subject: string;
  preheader: string;
  from_name: string;
  reply_to: string | null;
  created_at: string;
  updated_at: string;
}

export function campaignFromRow(r: CampaignRow): Campaign {
  return {
    id: r.id,
    name: r.name,
    country: r.country,
    product: r.product,
    description: r.description ?? undefined,
    templateId: r.template_id ?? "",
    status: r.status,
    subject: r.subject,
    preheader: r.preheader,
    fromName: r.from_name,
    replyTo: r.reply_to ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function campaignToRow(
  c: Partial<Campaign>,
  workspaceId: string,
): Omit<CampaignRow, "created_at" | "updated_at"> {
  return {
    id: c.id!,
    workspace_id: workspaceId,
    name: c.name ?? "",
    country: c.country ?? "",
    product: c.product ?? "",
    description: c.description ?? null,
    template_id: c.templateId || null,
    status: (c.status ?? "draft") as CampaignStatus,
    subject: c.subject ?? "",
    preheader: c.preheader ?? "",
    from_name: c.fromName ?? "",
    reply_to: c.replyTo ?? null,
  };
}

export interface CampaignRecipientRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  buyer_id: string;
  status: BuyerStatus;
  prepared_at: string | null;
  simulated_sent_at: string | null;
  created_at: string;
}

export function recipientFromRow(r: CampaignRecipientRow): CampaignRecipient {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    buyerId: r.buyer_id,
    status: r.status,
    preparedAt: r.prepared_at ?? undefined,
    simulatedSentAt: r.simulated_sent_at ?? undefined,
    createdAt: r.created_at,
  };
}

export function recipientToRow(
  r: Partial<CampaignRecipient>,
  workspaceId: string,
): Omit<CampaignRecipientRow, "created_at"> {
  return {
    id: r.id!,
    workspace_id: workspaceId,
    campaign_id: r.campaignId!,
    buyer_id: r.buyerId!,
    status: (r.status ?? "new") as BuyerStatus,
    prepared_at: r.preparedAt ?? null,
    simulated_sent_at: r.simulatedSentAt ?? null,
  };
}

export interface EmailTemplateRow {
  id: string;
  workspace_id: string;
  name: string;
  label: string | null;
  sections: EmailSection[];
  created_at: string;
  updated_at: string;
}

export function templateFromRow(r: EmailTemplateRow): EmailTemplate {
  return {
    id: r.id,
    name: r.name,
    label: r.label ?? undefined,
    sections: r.sections ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function templateToRow(
  t: Partial<EmailTemplate>,
  workspaceId: string,
): Omit<EmailTemplateRow, "created_at" | "updated_at"> {
  return {
    id: t.id!,
    workspace_id: workspaceId,
    name: t.name ?? "",
    label: t.label ?? null,
    sections: t.sections ?? [],
  };
}

export interface EmailAssetRow {
  id: string;
  workspace_id: string;
  slot: AssetSlot;
  name: string;
  production_url: string | null;
  local_data_url: string | null;
  updated_at: string;
}

export function assetFromRow(r: EmailAssetRow): AssetRecord {
  return {
    id: r.id,
    slot: r.slot,
    name: r.name,
    productionUrl: r.production_url ?? undefined,
    localDataUrl: r.local_data_url ?? undefined,
    updatedAt: r.updated_at,
  };
}

export function assetToRow(
  a: Partial<AssetRecord>,
  workspaceId: string,
): Omit<EmailAssetRow, "updated_at"> {
  return {
    id: a.id!,
    workspace_id: workspaceId,
    slot: a.slot as AssetSlot,
    name: a.name ?? "",
    production_url: a.productionUrl ?? null,
    local_data_url: a.localDataUrl ?? null,
  };
}

export interface ActivityEventRow {
  id: string;
  workspace_id: string;
  at: string;
  kind: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
}

export function activityFromRow(r: ActivityEventRow): ActivityEvent {
  return {
    id: r.id,
    at: r.at,
    kind: r.kind,
    message: r.message,
    entity:
      r.entity_type && r.entity_id
        ? { type: r.entity_type, id: r.entity_id }
        : undefined,
  };
}

export function activityToRow(
  e: Partial<ActivityEvent>,
  workspaceId: string,
): Omit<ActivityEventRow, "at"> & { at?: string } {
  return {
    id: e.id!,
    workspace_id: workspaceId,
    at: e.at,
    kind: e.kind ?? "",
    message: e.message ?? "",
    entity_type: e.entity?.type ?? null,
    entity_id: e.entity?.id ?? null,
  };
}

export interface WorkspaceSettingsRow {
  workspace_id: string;
  company: WorkspaceSettings["company"];
  brand: WorkspaceSettings["brand"];
  email: WorkspaceSettings["email"];
  onboarding_complete: boolean;
  created_at: string;
  updated_at: string;
}

export function settingsFromRow(r: WorkspaceSettingsRow): WorkspaceSettings {
  return {
    id: "singleton",
    company: r.company,
    brand: r.brand,
    email: r.email,
    onboardingComplete: r.onboarding_complete,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function settingsToRow(
  s: Partial<WorkspaceSettings>,
  workspaceId: string,
): Omit<WorkspaceSettingsRow, "created_at" | "updated_at"> {
  return {
    workspace_id: workspaceId,
    company: s.company!,
    brand: s.brand!,
    email: s.email!,
    onboarding_complete: s.onboardingComplete ?? true,
  };
}
