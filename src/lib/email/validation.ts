import type { AssetRecord, Buyer, Campaign, CampaignRecipient, EmailTemplate, WorkspaceSettings } from "@/lib/types";
import { renderEmailHtml, renderEmailText } from "./renderer";
import { detectUnresolvedTokens } from "./personalize";
import { isValidEmail } from "@/lib/utils";

export interface ValidationLine {
  ok: boolean;
  warn?: boolean;
  label: string;
}

export interface ValidationReport {
  lines: ValidationLine[];
  hasErrors: boolean;
  hasWarnings: boolean;
  recipientCount: number;
}

export function validateCampaign(args: {
  campaign: Campaign;
  recipients: CampaignRecipient[];
  buyers: Buyer[];
  template: EmailTemplate;
  settings: WorkspaceSettings;
  assets: AssetRecord[];
}): ValidationReport {
  const { campaign, recipients, buyers, template, settings, assets } = args;
  const lines: ValidationLine[] = [];
  const buyerById = new Map(buyers.map((b) => [b.id, b]));
  const recipientBuyers = recipients
    .map((r) => buyerById.get(r.buyerId))
    .filter((b): b is Buyer => !!b);

  const validEmailRecipients = recipientBuyers.filter((b) => isValidEmail(b.email));
  const invalidEmails = recipientBuyers.length - validEmailRecipients.length;

  lines.push({
    ok: recipientBuyers.length > 0,
    label:
      recipientBuyers.length > 0
        ? `${recipientBuyers.length} recipient${recipientBuyers.length === 1 ? "" : "s"} selected`
        : "No recipients selected",
  });

  lines.push({
    ok: invalidEmails === 0,
    label:
      invalidEmails === 0
        ? "All recipient email addresses valid"
        : `${invalidEmails} recipient email${invalidEmails === 1 ? "" : "s"} invalid`,
  });

  // Duplicate detection
  const emails = validEmailRecipients.map((b) => b.email.toLowerCase());
  const dupCount = emails.length - new Set(emails).size;
  lines.push({
    ok: dupCount === 0,
    label: dupCount === 0 ? "No duplicate recipients" : `${dupCount} duplicate recipient${dupCount === 1 ? "" : "s"}`,
  });

  lines.push({
    ok: !!campaign.subject?.trim(),
    label: campaign.subject?.trim() ? "Subject present" : "Subject missing",
  });

  // HTML/text rendering
  const assetsBySlot = Object.fromEntries(assets.map((a) => [a.slot, a]));
  let htmlOk = false;
  let textOk = false;
  let tokenIssues: string[] = [];
  try {
    const sampleBuyer = recipientBuyers[0] ?? null;
    const html = renderEmailHtml({ template, buyer: sampleBuyer, settings, assetsBySlot });
    const text = renderEmailText({ template, buyer: sampleBuyer, settings, assetsBySlot });
    htmlOk = html.length > 0;
    textOk = text.length > 0;
    tokenIssues = detectUnresolvedTokens(html);
  } catch {
    htmlOk = false;
    textOk = false;
  }
  lines.push({ ok: htmlOk, label: htmlOk ? "HTML renders" : "HTML failed to render" });
  lines.push({ ok: textOk, label: textOk ? "Plain-text version ready" : "Plain-text version missing" });
  lines.push({
    ok: tokenIssues.length === 0,
    label:
      tokenIssues.length === 0
        ? "Personalization resolved"
        : `Unresolved tokens: ${tokenIssues.join(", ")}`,
  });

  // CTA presence
  const ctaSection = template.sections.find((s) => s.type === "cta" && s.visible);
  const ctaUrl = ctaSection?.data.ctaUrl?.trim();
  lines.push({
    ok: !!ctaUrl,
    label: ctaUrl ? "Primary CTA destination set" : "Primary CTA missing destination",
  });

  // Assets: production URL readiness (warning, not error)
  const requiredSlots = ["hero"];
  const missingProdUrls = requiredSlots.filter((slot) => {
    const a = assetsBySlot[slot];
    return !a?.productionUrl?.trim();
  });
  if (missingProdUrls.length > 0) {
    lines.push({
      ok: true,
      warn: true,
      label: `${missingProdUrls.length} production image URL${missingProdUrls.length === 1 ? "" : "s"} missing (${missingProdUrls.join(", ")}) — required before live sending`,
    });
  } else {
    lines.push({ ok: true, label: "Production image URLs present" });
  }

  const hasErrors = lines.some((l) => !l.ok);
  const hasWarnings = lines.some((l) => !!l.warn);

  return {
    lines,
    hasErrors,
    hasWarnings,
    recipientCount: recipientBuyers.length,
  };
}
