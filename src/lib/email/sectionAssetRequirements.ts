import type { AssetSlot, EmailSection, EmailSectionType } from "@/lib/types";
import type { EffectiveVariant } from "./effectiveSections";

/**
 * MDF Outreach — the ONLY authoritative mapping between an
 * effectively-rendered email section and the asset slots that section
 * will actually try to render.
 *
 * Derived by reading src/lib/email/renderer.ts, not by consulting the
 * static SLOT_CATALOGUE. Update THIS file whenever the renderer starts
 * consuming a new slot in a section.
 *
 * Rules of the mapping:
 *   - Only slots that block the DELIVERY (send would show an obvious
 *     placeholder) are listed. Silent fallbacks (formats → hero) that
 *     the renderer handles gracefully via imagePlaceholder are NOT
 *     required — the placeholder is intentional design, not a broken
 *     send.
 *   - Decorative slots (texture / divider / doodle) are NEVER required.
 *     They are hard-coded exclusions below.
 *   - Slots that appear in SLOT_CATALOGUE but no section renderer reads
 *     (`logo`, `macro`, `orchard`, `farm`, `source`, variant_1..3) are
 *     never required because the renderer does not consult them today.
 */

/**
 * Sections that require specific asset slots when they render.
 * Empty list = no required slot for that section type.
 *
 * Signature variant, per section type (derived from renderer.ts):
 *
 *   intro      → no assets (typography only).
 *   hero       → assets["hero"] — placeholder on miss.
 *   heritage   → no assets.
 *   origin     → assets["origin"] || assets["hero"] — placeholder on miss.
 *   formats    → three optional per-format slots (stem/stemless/powder),
 *                each with a hero fallback and a placeholder fallback.
 *                Nothing hard-required — cells filter out if empty.
 *   packing    → assets["packing"] — placeholder on miss.
 *   why        → no assets.
 *   cta        → no assets.
 *   footer     → no assets.
 *
 * Direct variant (renderDirect):
 *
 *   The Direct renderer honours visible !== false for intro / hero /
 *   cta. Only the VISIBLE hero causes assets["hero"] to be rendered,
 *   so the hero slot is required only when hero is in the effective
 *   section list.
 */
const SIGNATURE_REQUIRED_BY_SECTION: Partial<Record<EmailSectionType, AssetSlot[]>> = {
  hero: ["hero"],
  origin: ["origin"],
  packing: ["packing"],
};

const DIRECT_REQUIRED_BY_SECTION: Partial<Record<EmailSectionType, AssetSlot[]>> = {
  hero: ["hero"],
};

/**
 * Slots that must NEVER be treated as required regardless of section
 * mapping. Decorative slots are the operator's optional embellishment;
 * missing them cannot block a live send.
 */
export const DECORATIVE_SLOTS: ReadonlySet<AssetSlot> = new Set<AssetSlot>([
  "texture",
  "divider",
  "doodle",
]);

/**
 * Return the SET of required slots for the given effective sections and
 * variant. Decorative slots are stripped defensively. This function is
 * pure — safe to call from tests, server actions and readiness classifier
 * alike.
 */
export function requiredSlotsForRendering(
  effectiveSections: EmailSection[],
  variant: EffectiveVariant,
): Set<AssetSlot> {
  const required = new Set<AssetSlot>();
  const mapping =
    variant === "direct" ? DIRECT_REQUIRED_BY_SECTION : SIGNATURE_REQUIRED_BY_SECTION;

  for (const section of effectiveSections) {
    const slots = mapping[section.type];
    if (!slots) continue;
    for (const slot of slots) required.add(slot);
  }
  return stripDecorative(required);
}

function stripDecorative(set: Set<AssetSlot>): Set<AssetSlot> {
  for (const s of DECORATIVE_SLOTS) set.delete(s);
  return set;
}
