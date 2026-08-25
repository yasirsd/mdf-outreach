import type { Campaign, EmailTemplate } from "@/lib/types";

/**
 * Produce a renderable EmailTemplate from a campaign.
 *
 * If the campaign has a snapshot (`emailSections`), we render from that
 * snapshot — the shared master template is NEVER used to render a
 * campaign's own email. If the campaign has no snapshot yet, fall back to
 * the master template so previews still show something useful during the
 * pre-selection UX.
 */
export function resolveCampaignTemplate(
  campaign: Campaign,
  master: EmailTemplate | null | undefined,
): EmailTemplate | null {
  if (campaign.emailSections && campaign.emailSections.length > 0) {
    return {
      id: `campaign-${campaign.id}`,
      name: master?.name ?? campaign.name,
      label: master?.label,
      sections: campaign.emailSections,
      themeKey: campaign.themeKey,
      variant: campaign.templateVariant,
      version: master?.version ?? 1,
      status: master?.status ?? "approved",
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
    };
  }
  return master ?? null;
}
