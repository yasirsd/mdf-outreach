"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { serverRepositories } from "@/lib/repositories/server";
import { logActivity } from "@/lib/activity";
import type { Campaign, CampaignRecipient, EmailTemplate } from "@/lib/types";

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export async function createCampaignAction(input: Partial<Campaign>): Promise<Campaign> {
  const { repos } = await serverRepositories();
  const now = new Date().toISOString();
  const c: Campaign = {
    id: randomUUID(),
    name: input.name || `${input.country ?? ""} — ${input.product ?? ""}`.trim() || "New campaign",
    country: input.country ?? "",
    product: input.product ?? "",
    description: input.description ?? "",
    templateId: input.templateId ?? "",
    status: input.status ?? "draft",
    subject: input.subject ?? "",
    preheader: input.preheader ?? "",
    fromName: input.fromName ?? "",
    replyTo: input.replyTo ?? "",
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

export async function updateCampaignAction(id: string, patch: Partial<Campaign>): Promise<Campaign> {
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
