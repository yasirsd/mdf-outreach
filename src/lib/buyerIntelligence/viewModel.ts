import { calculateBasicLegitimacy, classifyContactAccess } from "./assessment";
import { contactAccessSummary } from "./derived";
import { calculateBasicTradeSummary } from "./metrics";
import { calculateBuyerPotential } from "./potential";
import { projectProducts, projectSuppliers } from "./projections";
import { calculateOutreachReadiness, type OutreachReadinessInput } from "./readiness";
import type {
  AssessmentClassification, AssessmentEvidenceReference, BasicTradeSummary,
  BuyerIntelligenceAssessment, BuyerIntelligenceAssessmentEvidence,
  BuyerIntelligenceClaim, BuyerIntelligenceSource, BuyerIntelligenceViewModel,
  BuyerPotentialResult, BuyerTradeMetric, ContactAccessInput, ContactAccessLevel,
  EvidenceLevel, IntelligenceAssessmentType, LegitimacyResult,
  OutreachReadinessResult, TradeObservationPage,
} from "./types";

function numberMetric(metrics: BuyerTradeMetric[], key: string): number | undefined {
  const metric = metrics.find((row) => row.metricKey === key);
  return metric?.value.type === "number" ? metric.value.value : undefined;
}
function textMetric(metrics: BuyerTradeMetric[], key: string): string | undefined {
  const metric = metrics.find((row) => row.metricKey === key);
  return metric?.value.type === "text" ? metric.value.value : undefined;
}
function jsonMetric<T>(metrics: BuyerTradeMetric[], key: string): T | undefined {
  const metric = metrics.find((row) => row.metricKey === key);
  return metric?.value.type === "json" ? (metric.value.value as T) : undefined;
}

function summaryFromMetrics(metrics: BuyerTradeMetric[], observations: TradeObservationPage): BasicTradeSummary {
  if (metrics.length === 0 && !observations.nextCursor) return calculateBasicTradeSummary(observations.rows);
  return {
    lastObservedTrade: textMetric(metrics, "last_observed_trade"),
    tradeObservationCount: numberMetric(metrics, "trade_observation_count") ?? 0,
    shipmentCount: numberMetric(metrics, "shipment_count") ?? 0,
    activityLast12Months: numberMetric(metrics, "activity_last_12_months") ?? 0,
    indiaObservationCount: numberMetric(metrics, "india_observation_count") ?? 0,
    indiaShipmentCount: numberMetric(metrics, "india_shipment_count") ?? 0,
    indiaShipmentShare: numberMetric(metrics, "india_observation_share"),
    lastObservedIndiaTrade: textMetric(metrics, "last_observed_india_trade"),
    originCountryDistribution: jsonMetric(metrics, "origin_country_distribution") ?? [],
    supplierCount: numberMetric(metrics, "supplier_count") ?? 0,
    supplierRanking: jsonMetric(metrics, "supplier_ranking") ?? [],
  };
}

function evidenceFor(assessmentId: string, links: BuyerIntelligenceAssessmentEvidence[]): AssessmentEvidenceReference[] {
  return links.flatMap((link) => {
    if (link.assessmentId !== assessmentId) return [];
    const id = link.claimId ?? link.observationId ?? link.metricId;
    return id ? [{ kind: link.kind, id, componentKey: link.componentKey }] : [];
  });
}

function persistedAssessment(
  assessments: BuyerIntelligenceAssessment[], links: BuyerIntelligenceAssessmentEvidence[],
  type: IntelligenceAssessmentType, allowed: readonly AssessmentClassification[],
) {
  const row = assessments.find((assessment) => assessment.assessmentType === type && !assessment.supersededAt);
  if (!row || !allowed.includes(row.classification)) return undefined;
  return { classification: row.classification, summary: row.summary, components: row.components, evidence: evidenceFor(row.id, links) };
}

export function buildBuyerIntelligenceViewModel(input: {
  sources: BuyerIntelligenceSource[]; claims: BuyerIntelligenceClaim[];
  trade: TradeObservationPage; metrics: BuyerTradeMetric[];
  assessments: BuyerIntelligenceAssessment[];
  assessmentEvidence?: BuyerIntelligenceAssessmentEvidence[];
  contactAccess: ContactAccessInput; readiness?: OutreachReadinessInput;
}): BuyerIntelligenceViewModel {
  const links = input.assessmentEvidence ?? [];
  const evidenceCounts: Record<EvidenceLevel, number> = { 1: 0, 2: 0, 3: 0 };
  for (const row of [...input.claims, ...input.trade.rows]) evidenceCounts[row.evidenceLevel] += 1;

  const legitimacy = persistedAssessment(input.assessments, links, "buyer_legitimacy", ["verified", "strong_evidence", "moderate_evidence", "weak_signal", "no_evidence_found"]) as LegitimacyResult | undefined;
  const potential = persistedAssessment(input.assessments, links, "buyer_potential", ["high", "medium", "low", "insufficient_evidence"]) as BuyerPotentialResult | undefined;
  const persistedContact = persistedAssessment(input.assessments, links, "contact_access", ["company_only", "public_route", "named_contact", "direct_contact", "credit_enriched"]);
  const contactAccess = (persistedContact?.classification ?? classifyContactAccess(input.contactAccess)) as ContactAccessLevel;
  const readiness = persistedAssessment(input.assessments, links, "outreach_readiness", ["needs_review", "needs_contact", "ready_for_conversion", "ready_for_outreach", "suppressed", "not_eligible"]) as OutreachReadinessResult | undefined;
  const fallbackReadiness: OutreachReadinessResult = input.readiness
    ? calculateOutreachReadiness(input.readiness)
    : { classification: "needs_review", summary: "Candidate lifecycle data is unavailable for readiness assessment.", components: [], evidence: [] };

  return {
    overview: {
      legitimacy: legitimacy ?? calculateBasicLegitimacy({ sources: input.sources, claims: input.claims, observations: input.trade.rows }),
      buyerPotential: potential ?? calculateBuyerPotential(input.trade.rows),
      contactAccess,
      contactAccessSummary: persistedContact?.summary ?? contactAccessSummary(contactAccess),
      outreachReadiness: readiness ?? fallbackReadiness,
      metrics: summaryFromMetrics(input.metrics, input.trade), evidenceCounts,
      linkedAssessmentEvidenceCount: links.length,
    },
    trade: input.trade,
    sources: input.sources.map((source) => {
      const seen = new Set<string>();
      const evidence = [...input.claims, ...input.trade.rows].filter((row) => row.sourceId === source.id).flatMap((row) => {
        const key = `${row.evidenceLevel}:${row.evidenceType}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ evidenceType: row.evidenceType, evidenceLevel: row.evidenceLevel }];
      });
      return { id: source.id, providerId: source.providerId, sourceType: source.sourceType,
        safeSourceRef: source.safeSourceRef, sourceUrl: source.sourceUrl,
        accessClass: source.accessClass, costClass: source.costClass,
        observedAt: source.observedAt, retrievedAt: source.retrievedAt, evidence };
    }),
    suppliers: projectSuppliers(input.trade.rows), products: projectProducts(input.trade.rows),
    projectionsComplete: !input.trade.nextCursor,
  };
}

export function emptyBuyerIntelligenceViewModel(contactAccess: ContactAccessInput): BuyerIntelligenceViewModel {
  return buildBuyerIntelligenceViewModel({ sources: [], claims: [], trade: { rows: [] }, metrics: [], assessments: [], contactAccess });
}
