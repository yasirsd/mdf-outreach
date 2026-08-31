/**
 * Operator-facing reveal-priority copy. Presentation only.
 * Never changes revealPriority classification. Never calls reveal.
 */

import { revealPriorityTierForTitle, type RevealPriorityTier } from "./revealPriority";

function normalizeTitle(jobTitle: string | null | undefined): string {
  return (jobTitle ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const SPECIFIC: Array<[RegExp, string]> = [
  [/\bdirector of agricultural commodit/, "Agricultural commodities / trading leadership"],
  [/\b(agri|agricultural|agriculture).*(commodit|trad)/, "Agricultural commodities / trading leadership"],
  [/\bcategory manager\b/, "Category management / buying role"],
  [/\b(head of procurement|procurement manager|procurement director)\b/, "Procurement / purchasing role"],
  [/\bpurchasing manager\b/, "Procurement / purchasing role"],
  [/\bsourcing manager\b|\bhead of sourcing\b/, "Sourcing role"],
  [/\bimport manager\b|\bhead of import/, "Import / sourcing role"],
  [/\bcommodity trader\b/, "Commodity trading role"],
  [/\bhead of trading\b|\btrading director\b/, "Trading leadership"],
  [/\bsupply chain\b/, "Supply-chain leadership"],
  [/\bcommercial manager\b|\bcommercial director\b/, "Commercial leadership"],
  [/\bmanaging director\b/, "Senior executive fallback"],
  [/\b(sales executive|sales manager|sales director|sales)\b/, "Sales-focused role"],
  [/\b(accountant|accounting|finance)\b/, "Finance / accounting"],
];

export function revealPriorityReason(
  jobTitle: string | null | undefined,
  tier: RevealPriorityTier = revealPriorityTierForTitle(jobTitle),
): string {
  if (tier === "none") return "";
  const title = normalizeTitle(jobTitle);
  for (const [pattern, label] of SPECIFIC) {
    if (pattern.test(title)) return label;
  }
  if (tier === "high") {
    if (/\b(agri|agricultural|agriculture|commodit(?:y|ies))\b/.test(title)) {
      return "Agricultural commodities / trading leadership";
    }
    if (/\b(trader|trading|origination)\b/.test(title)) return "Trading leadership";
    if (/\b(procurement|purchasing|purchase)\b/.test(title)) return "Procurement / purchasing role";
    if (/\bsourcing\b/.test(title)) return "Sourcing role";
    if (/\bimport\b/.test(title)) return "Import / sourcing role";
    if (/\bcategory\b/.test(title)) return "Category management / buying role";
    return "Purchasing / sourcing leadership";
  }
  if (tier === "medium") {
    if (/\b(supply chain|commercial|general manager)\b/.test(title)) {
      return "Senior commercial leadership";
    }
    return "Executive fallback";
  }
  if (/\b(sales|marketing)\b/.test(title)) return "Sales-focused role";
  return "Finance / accounting";
}

export function revealPriorityBadgeLabel(tier: RevealPriorityTier): string {
  if (tier === "high") return "High priority";
  if (tier === "medium") return "Medium priority";
  if (tier === "low") return "Low priority";
  return "";
}
