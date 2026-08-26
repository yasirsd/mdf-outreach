import type { AssetRecord, EmailTemplate } from "@/lib/types";
import type { ProductKey } from "@/lib/email/themes/types";
import { slotsFor } from "@/lib/assets/slots";

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
 * Validates that a campaign is safe to LIVE SEND (Phase E / Gmail).
 *
 * Every required slot for the template's product theme must have an
 * approved asset in `production` status, with a public HTTPS
 * production URL and meaningful alt text (unless the slot is
 * decorative).
 *
 * Not used by the current SimulationEmailProvider — but wired here
 * so the future Gmail integration cannot ship without it.
 */
export function preflightAssetsForSend(
  template: EmailTemplate,
  assets: Record<string, AssetRecord | undefined>,
): AssetPreflightFinding[] {
  const themeKey = template.themeKey as ProductKey | undefined;
  if (!themeKey) return [];
  const findings: AssetPreflightFinding[] = [];
  for (const spec of slotsFor(themeKey)) {
    if (!spec.required) continue;
    const asset = assets[spec.slot];
    if (!asset) {
      findings.push({
        slot: spec.slot,
        themeKey,
        reason: "missing",
        message: `Required asset "${spec.label}" is not uploaded.`,
      });
      continue;
    }
    if (!asset.productionUrl?.trim()) {
      findings.push({
        slot: spec.slot,
        themeKey,
        reason: "no-production-url",
        message: `"${spec.label}" has no hosted production URL.`,
      });
      continue;
    }
    if (asset.status !== "production") {
      findings.push({
        slot: spec.slot,
        themeKey,
        reason: "not-production-status",
        message: `"${spec.label}" is not promoted to Production (current: ${asset.status}).`,
      });
    }
    if (!asset.isDecorative && !asset.altText?.trim()) {
      findings.push({
        slot: spec.slot,
        themeKey,
        reason: "no-alt-text",
        message: `"${spec.label}" is missing alt text.`,
      });
    }
  }
  return findings;
}
