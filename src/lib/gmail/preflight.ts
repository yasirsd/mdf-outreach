import type { AssetRecord, Campaign, EmailTemplate } from "@/lib/types";
import { preflightAssetsForSend, type AssetPreflightFinding } from "@/lib/email/sendPreflight";
import { detectUnresolvedTokens } from "@/lib/email/personalize";
import { preflightCtaUrls } from "@/lib/email/ctaUrl";

export interface FullPreflightInput {
  campaign: Campaign | null;
  template: EmailTemplate | null;
  html: string;
  text: string;
  assetsBySlot: Record<string, AssetRecord | undefined>;
  recipient: string;
}

export interface FullPreflightResult {
  ok: boolean;
  blockers: string[];
  assetFindings: AssetPreflightFinding[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Server-side "am I safe to actually hand this to Gmail?" check.
 * Called both when the UI asks for a dry preflight AND immediately
 * before the actual send.
 *
 * Asset requirements are computed from the SECTIONS THE SEND RENDERER
 * WILL ACTUALLY EMIT — the campaign snapshot when present, filtered by
 * variant + visibility. Hidden sections do NOT contribute required
 * assets. See src/lib/email/effectiveSections.ts + sectionAssetRequirements.ts.
 */
export function fullPreflight(input: FullPreflightInput): FullPreflightResult {
  const blockers: string[] = [];

  if (!input.campaign) blockers.push("Campaign missing.");
  if (!input.template) blockers.push("Campaign has no template snapshot yet.");
  if (input.campaign && !input.campaign.subject?.trim()) blockers.push("Subject is empty.");
  if (!input.html.trim()) blockers.push("Rendered HTML is empty.");
  if (!input.text.trim()) blockers.push("Plain-text alternative is empty.");
  if (!EMAIL_RE.test(input.recipient)) blockers.push("Recipient email is invalid.");

  // Base64 must never appear in a message we hand to Gmail.
  if (input.html.includes("data:image/") || input.html.includes(";base64,")) {
    blockers.push("Rendered HTML contains a Base64 image. Only production URLs are allowed.");
  }

  // Unresolved personalization tokens (e.g. "Hi {{first_name}}") in
  // either body are a blocker.
  const htmlTokens = detectUnresolvedTokens(input.html);
  const textTokens = detectUnresolvedTokens(input.text);
  const allTokens = Array.from(new Set([...htmlTokens, ...textTokens]));
  if (allTokens.length > 0) {
    blockers.push(`Unresolved personalization: ${allTokens.join(", ")}.`);
  }

  const assetFindings = input.template
    ? preflightAssetsForSend(input.template, input.assetsBySlot, input.campaign)
    : [];
  for (const f of assetFindings) blockers.push(f.message);

  // F8 — CTA URL contract: reject href="#" / relative / javascript: / etc.
  // ONLY when a CTA button will actually render for the given campaign.
  // Hidden or unlabelled buttons produce no findings.
  if (input.template) {
    const ctaFindings = preflightCtaUrls(input.template, input.campaign);
    for (const f of ctaFindings) blockers.push(f.message);
  }

  return { ok: blockers.length === 0, blockers, assetFindings };
}
