import type {
  BuyerPotentialResult,
  BuyerTradeObservation,
} from "./types";

export const BUYER_POTENTIAL_CALCULATION_VERSION = "bi2-potential-v1";

function verifiedTrade(row: BuyerTradeObservation): boolean {
  return (
    row.evidenceLevel === 1 &&
    (row.granularity === "shipment" || row.granularity === "transaction")
  );
}

export function calculateBuyerPotential(
  observations: BuyerTradeObservation[],
  options: { asOf?: Date } = {},
): BuyerPotentialResult {
  const asOf = options.asOf ?? new Date();
  const recentStart = new Date(asOf);
  // Inclusive date window: as-of day plus the preceding 364 calendar days.
  recentStart.setUTCDate(recentStart.getUTCDate() - 364);
  const start = recentStart.toISOString().slice(0, 10);
  const end = asOf.toISOString().slice(0, 10);
  const verified = observations.filter(verifiedTrade);

  if (verified.length === 0) {
    return {
      classification: "insufficient_evidence",
      summary: "Verified trade evidence is insufficient to assess Buyer potential.",
      components: [],
      evidence: [],
    };
  }

  const mdfOverlap = verified.filter((row) => Boolean(row.mdfProductId));
  const productEvidence = verified.filter(
    (row) =>
      Boolean(row.mdfProductId) ||
      Boolean(row.normalizedProductCategory) ||
      Boolean(row.hsCodeRaw),
  );
  const recent = verified.filter(
    (row) => Boolean(row.tradeDate) && (row.tradeDate as string) >= start && (row.tradeDate as string) <= end,
  );
  const india = verified.filter((row) => row.originCountryCode === "IN");

  const classification =
    mdfOverlap.length > 0 && (recent.length > 0 || india.length > 0)
      ? "high"
      : productEvidence.length > 0 || recent.length > 0 || india.length > 0
        ? "medium"
        : "low";
  const summary =
    classification === "high"
      ? "Verified trade includes authoritative MDF product overlap and recent or India-origin activity."
      : classification === "medium"
        ? "Verified trade has at least one relevant product, recency, or India-origin signal."
        : "Verified trade exists, but MDF relevance and recent activity are not established.";

  return {
    classification,
    summary,
    components: [
      {
        key: "verified_activity",
        explanation: `${verified.length} verified trade observation${verified.length === 1 ? "" : "s"}.`,
        evidenceCount: verified.length,
      },
      {
        key: "mdf_product_overlap",
        explanation: `${mdfOverlap.length} verified observation${mdfOverlap.length === 1 ? "" : "s"} with an authoritative MDF product match.`,
        evidenceCount: mdfOverlap.length,
      },
      {
        key: "recent_activity",
        explanation: `${recent.length} verified observation${recent.length === 1 ? "" : "s"} in the trailing 12 months.`,
        evidenceCount: recent.length,
      },
      {
        key: "india_sourcing",
        explanation: `${india.length} verified India-origin observation${india.length === 1 ? "" : "s"}.`,
        evidenceCount: india.length,
      },
    ],
    evidence: [
      ...verified.map((row) => ({ kind: "observation" as const, id: row.id, componentKey: "verified_activity" })),
      ...mdfOverlap.map((row) => ({ kind: "observation" as const, id: row.id, componentKey: "mdf_product_overlap" })),
      ...recent.map((row) => ({ kind: "observation" as const, id: row.id, componentKey: "recent_activity" })),
      ...india.map((row) => ({ kind: "observation" as const, id: row.id, componentKey: "india_sourcing" })),
    ],
  };
}
