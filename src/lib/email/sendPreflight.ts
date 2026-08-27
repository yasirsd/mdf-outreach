import type { AssetRecord, AssetSlot, Campaign, EmailTemplate } from "@/lib/types";
import { effectiveSections } from "./effectiveSections";
import {
  DECORATIVE_SLOTS,
  requiredSlotsForRendering,
} from "./sectionAssetRequirements";

export interface AssetPreflightFinding {
  slot: string;
  themeKey: string;
  reason:
    | "missing"
    | "no-production-url"
    | "not-production-status"
    | "no-alt-text";
  message: string;
}

/**
 * Validate assets required to LIVE SEND (Gmail / Buyer Send).
 *
 * The set of REQUIRED slots is derived from the sections that the SEND
 * renderer will actually emit for the given campaign snapshot + variant.
 * Hidden Signature sections and unused Direct sections contribute nothing.
 * Decorative slots (texture / divider / doodle) can never block a send.
 *
 * The same helper is used by:
 *   - fullPreflight (Real Gmail Test dry-run + final send)
 *   - Buyer Send readiness classifier
 *   - Buyer Send server action (belt-and-suspenders re-check before Gmail)
 *
 * so what the operator sees on the review page equals what the server
 * enforces before Gmail is called.
 */
export function preflightAssetsForSend(
  template: EmailTemplate,
  assetsBySlot: Record<string, AssetRecord | undefined>,
  campaign?: Pick<Campaign, "emailSections" | "templateVariant"> | null,
): AssetPreflightFinding[] {
  const themeKey = template.themeKey ?? "";
  const { sections, variant } = effectiveSections(template, campaign);
  const required = requiredSlotsForRendering(sections, variant);

  const findings: AssetPreflightFinding[] = [];
  for (const slot of required) {
    if (DECORATIVE_SLOTS.has(slot)) continue;
    const asset = assetsBySlot[slot];
    const label = slotLabel(slot);

    if (!asset) {
      findings.push({
        slot,
        themeKey,
        reason: "missing",
        message: `Required asset "${label}" is not uploaded.`,
      });
      continue;
    }
    if (!asset.productionUrl?.trim()) {
      findings.push({
        slot,
        themeKey,
        reason: "no-production-url",
        message: `"${label}" has no hosted production URL.`,
      });
      continue;
    }
    if (asset.status !== "production") {
      findings.push({
        slot,
        themeKey,
        reason: "not-production-status",
        message: `"${label}" is not promoted to Production (current: ${asset.status}).`,
      });
    }
    if (!asset.isDecorative && !asset.altText?.trim()) {
      findings.push({
        slot,
        themeKey,
        reason: "no-alt-text",
        message: `"${label}" is missing alt text.`,
      });
    }
  }
  return findings;
}

// Human-friendly names for the small set of slots we actually enforce.
// Full slot vocabulary lives in src/lib/assets/slots.ts — this map is
// intentionally narrow.
function slotLabel(slot: AssetSlot): string {
  switch (slot) {
    case "hero":
      return "Hero";
    case "origin":
      return "Origin";
    case "packing":
      return "Packing";
    default:
      return typeof slot === "string" ? slot.charAt(0).toUpperCase() + slot.slice(1) : String(slot);
  }
}
