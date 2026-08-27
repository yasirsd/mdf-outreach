"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { serverRepositories } from "@/lib/repositories/server";
import { logActivity } from "@/lib/activity";
import { isProductKey } from "@/lib/email/themes/catalogue";
import type {
  Campaign,
  CampaignRecipient,
  EmailSection,
  EmailTemplate,
  TemplateVariant,
} from "@/lib/types";

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function snapshotSections(sections: EmailSection[]): EmailSection[] {
  // Deep copy so future master edits never leak into a campaign snapshot.
  return sections.map((s) => ({
    id: `${s.type}-${Math.random().toString(36).slice(2, 8)}`,
    type: s.type,
    visible: s.visible,
    data: { ...s.data },
  }));
}

/**
 * If the workspace has a `defaultCtaUrl` configured, seed the CTA
 * destination on every section that renders a button (hero / packing /
 * cta) IN THE SNAPSHOT — but ONLY where the master template shipped no
 * CTA URL of its own (empty or `"#"`). We never silently overwrite a
 * per-section CTA the master library defined intentionally.
 *
 * The seeding runs at snapshot-time only. Editing the workspace default
 * later never mutates existing campaign snapshots.
 */
function seedCtaDefaults(
  sections: EmailSection[],
  defaultCtaUrl: string | undefined | null,
): EmailSection[] {
  const url = (defaultCtaUrl ?? "").trim();
  if (!url) return sections;
  const CTA_SECTIONS = new Set(["hero", "packing", "cta"]);
  return sections.map((s) => {
    if (!CTA_SECTIONS.has(s.type)) return s;
    const current = (s.data.ctaUrl ?? "").trim();
    if (current && current !== "#") return s;
    return { ...s, data: { ...s.data, ctaUrl: url } };
  });
}

export async function createCampaignAction(input: Partial<Campaign>): Promise<Campaign> {
  const { repos } = await serverRepositories();
  const now = new Date().toISOString();
  const themeKey = isProductKey(input.themeKey ?? "") ? input.themeKey : undefined;
  const c: Campaign = {
    id: randomUUID(),
    name: input.name || `${input.country ?? ""} — ${input.product ?? ""}`.trim() || "New campaign",
    country: input.country ?? "",
    product: input.product ?? "",
    description: input.description ?? "",
    templateId: "",
    status: input.status ?? "draft",
    subject: input.subject ?? "",
    preheader: input.preheader ?? "",
    fromName: input.fromName ?? "",
    replyTo: input.replyTo ?? "",
    themeKey,
    createdAt: now,
    updatedAt: now,
  };
  const created = await repos.campaigns.create(c);
  await logActivity(repos, "campaign.created", `Campaign "${created.name}" created`, {
    type: "campaign",
    id: created.id,
  });
  revalidatePath("/campaigns");
  revalidatePath("/");
  return created;
}

export async function updateCampaignAction(
  id: string,
  patch: Partial<Campaign>,
): Promise<Campaign> {
  const { repos } = await serverRepositories();
  const { createdAt: _c, updatedAt: _u, id: _i, ...clean } = patch;
  const updated = await repos.campaigns.update(id, clean);
  await logActivity(repos, "campaign.updated", `${updated.name} updated`, {
    type: "campaign",
    id,
  });
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/");
  return updated;
}

export async function deleteCampaignAction(id: string): Promise<void> {
  const { repos } = await serverRepositories();
  const c = await repos.campaigns.get(id);
  await repos.campaigns.delete(id);
  if (c) {
    await logActivity(repos, "campaign.deleted", `${c.name} deleted`, { type: "campaign", id });
  }
  revalidatePath("/campaigns");
  revalidatePath("/");
}

/**
 * Copies the master template into the campaign as a snapshot. The master
 * itself is NEVER modified. Compatibility (product theme match) is
 * enforced server-side — a Guntur campaign cannot adopt a Mango template.
 */
export async function useTemplateForCampaignAction(
  campaignId: string,
  templateId: string,
): Promise<Campaign> {
  const { repos } = await serverRepositories();
  const [campaign, template, settings] = await Promise.all([
    repos.campaigns.get(campaignId),
    repos.templates.get(templateId),
    repos.settings.get(),
  ]);
  if (!campaign) throw new Error("Campaign not found");
  if (!template) throw new Error("Template not found");
  if (campaign.themeKey && template.themeKey && campaign.themeKey !== template.themeKey) {
    throw new Error(
      `Template is for a different product (${template.themeKey}) than this campaign (${campaign.themeKey}).`,
    );
  }
  // Snapshot the master; then seed CTA destinations from the workspace
  // default when the master shipped no per-section CTA URL of its own.
  const snapshot = seedCtaDefaults(
    snapshotSections(template.sections ?? []),
    settings?.email.defaultCtaUrl,
  );
  const patch: Partial<Campaign> = {
    templateId: template.id,
    themeKey: template.themeKey ?? campaign.themeKey,
    templateVariant: template.variant as TemplateVariant | undefined,
    emailSections: snapshot,
  };
  const updated = await repos.campaigns.update(campaignId, patch);
  await logActivity(
    repos,
    "campaign.template.selected",
    `${updated.name} → ${template.name}`,
    { type: "campaign", id: campaignId },
  );
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath(`/campaigns/${campaignId}/email`);
  revalidatePath(`/campaigns/${campaignId}/preview`);
  revalidatePath(`/campaigns/${campaignId}/send`);
  return updated;
}

/**
 * Persists the campaign's own edited email sections. Mutates the campaign
 * snapshot only — never touches the shared master template.
 */
export async function saveCampaignEmailAction(
  campaignId: string,
  sections: EmailSection[],
): Promise<Campaign> {
  const { repos } = await serverRepositories();
  const updated = await repos.campaigns.update(campaignId, {
    emailSections: sections,
  });
  await logActivity(
    repos,
    "campaign.email.updated",
    `${updated.name} email updated`,
    { type: "campaign", id: campaignId },
  );
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath(`/campaigns/${campaignId}/email`);
  revalidatePath(`/campaigns/${campaignId}/preview`);
  return updated;
}

export async function addRecipientsAction(
  campaignId: string,
  buyerIds: string[],
): Promise<{ added: number }> {
  const { repos } = await serverRepositories();
  const campaign = await repos.campaigns.get(campaignId);
  if (!campaign) throw new Error("Campaign not found");
  const now = new Date().toISOString();
  let added = 0;
  for (const buyerId of buyerIds) {
    if (!isUuid(buyerId)) continue;
    const existing = await repos.recipients.find(campaignId, buyerId);
    if (existing) continue;
    const buyer = await repos.buyers.get(buyerId);
    if (!buyer) continue;
    await repos.recipients.add({
      id: randomUUID(),
      campaignId,
      buyerId,
      status: buyer.status,
      createdAt: now,
    });
    added += 1;
  }
  if (added > 0) {
    await logActivity(
      repos,
      "campaign.recipients.added",
      `${added} recipient${added === 1 ? "" : "s"} added to ${campaign.name}`,
      { type: "campaign", id: campaignId },
    );
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath(`/campaigns/${campaignId}/recipients`);
  }
  return { added };
}

export async function removeRecipientAction(recipientId: string, campaignId: string): Promise<void> {
  const { repos } = await serverRepositories();
  await repos.recipients.remove(recipientId);
  revalidatePath(`/campaigns/${campaignId}/recipients`);
}

export async function markRecipientPreparedAction(
  recipientId: string,
  campaignId: string,
): Promise<CampaignRecipient> {
  const { repos } = await serverRepositories();
  const r = await repos.recipients.update(recipientId, {
    preparedAt: new Date().toISOString(),
  });
  revalidatePath(`/campaigns/${campaignId}/send`);
  return r;
}

export async function markRecipientSimulatedSentAction(
  recipientId: string,
  buyerId: string,
  campaignId: string,
): Promise<CampaignRecipient> {
  const { repos } = await serverRepositories();
  const now = new Date().toISOString();
  const r = await repos.recipients.update(recipientId, {
    simulatedSentAt: now,
    status: "contacted",
  });
  await repos.buyers.update(buyerId, { status: "contacted", lastContactedAt: now });
  revalidatePath(`/campaigns/${campaignId}/send`);
  revalidatePath("/buyers");
  return r;
}

/**
 * @deprecated Campaign editing now saves to the campaign snapshot instead
 * of the master template. Kept only for cases where a real admin edit to
 * the master library is intentional; not called from normal campaign flow.
 */
export async function saveTemplateAction(template: EmailTemplate): Promise<EmailTemplate> {
  const { repos } = await serverRepositories();
  const existing = template.id && isUuid(template.id) ? await repos.templates.get(template.id) : undefined;
  if (existing) {
    const updated = await repos.templates.update(template.id, template);
    revalidatePath("/templates");
    return updated;
  }
  const created = await repos.templates.create({
    ...template,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  revalidatePath("/templates");
  return created;
}
