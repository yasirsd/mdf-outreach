import type { Campaign, EmailSection, EmailTemplate, TemplateVariant } from "@/lib/types";

/**
 * MDF Outreach — single source of truth for "which sections will the
 * SEND-mode renderer actually put in the delivered email?".
 *
 * Historically, preflight consulted a hardcoded per-theme slot catalogue
 * and required assets for slots the section wasn't actually going to
 * render (e.g. the Hero slot for a campaign that had hidden the Hero
 * section). This helper corrects that by mirroring exactly what
 * renderer.ts does at render time:
 *
 *   - The Signature variant renders `template.sections.filter(s => s.visible)`.
 *   - The Direct variant finds `intro`, `hero`, and `cta` by type and
 *     now HONOURS `visible !== false` — the composer exposes a
 *     visibility toggle for every section including Direct's, so
 *     hiding a section here must actually omit it from the delivered
 *     email.
 *
 * When a campaign snapshot exists (campaign.emailSections), it OVERRIDES
 * the master template's sections — that's the same rule
 * resolveCampaignTemplate() applies. When no campaign is supplied (e.g.
 * the Templates library preview), we operate on the master template.
 */

export type EffectiveVariant = TemplateVariant | "signature";

export interface EffectiveSectionsResult {
  variant: EffectiveVariant;
  sections: EmailSection[];
}

/**
 * Compute the sections the SEND renderer will actually emit.
 *
 * Rules:
 *   1. If campaign.emailSections is non-empty, prefer it over
 *      template.sections. Master is never mutated by preflight.
 *   2. Variant precedence: campaign.templateVariant > template.variant
 *      > "signature".
 *   3. Signature: sections filtered to `visible !== false`.
 *   4. Direct: intro / hero / cta ONLY, each also filtered to
 *      `visible !== false` — matches renderDirect()'s updated
 *      behaviour after Phase F1 follow-up.
 */
export function effectiveSections(
  template: EmailTemplate,
  campaign?: Pick<Campaign, "emailSections" | "templateVariant"> | null,
): EffectiveSectionsResult {
  const source: EmailSection[] =
    campaign?.emailSections && campaign.emailSections.length > 0
      ? campaign.emailSections
      : (template.sections ?? []);

  const variant: EffectiveVariant =
    (campaign?.templateVariant as TemplateVariant | undefined) ??
    (template.variant as TemplateVariant | undefined) ??
    "signature";

  if (variant === "direct") {
    const wanted: EmailSection[] = [];
    for (const type of ["intro", "hero", "cta"] as const) {
      const found = source.find((s) => s.type === type && s.visible !== false);
      if (found) wanted.push(found);
    }
    return { variant, sections: wanted };
  }

  return {
    variant: "signature",
    sections: source.filter((s) => s.visible !== false),
  };
}
