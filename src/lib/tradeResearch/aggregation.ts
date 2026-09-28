import type {
  TradeResearchAggregateConflict,
  TradeResearchAggregateDimensionSummary,
  TradeResearchAggregateEvidenceState,
  TradeResearchAggregateResult,
  TradeResearchEvidenceAssessment,
  TradeResearchProviderEvidence,
  TradeResearchProviderResult,
} from "./types";

type Dimension = "identity" | "product" | "origin" | "india_origin" | "shipment" | "program";
type ConflictDimension = Dimension | "coverage";

const evaluatedStatuses = new Set(["completed", "no_match", "cached"]);

export function tradeResearchSourceFamily(providerId: string): string {
  if (providerId === "fda-fsvp" || providerId === "fda-vqip") return "fda-program-lists";
  if (providerId === "canada-cid") return "canada-importer-directory";
  return providerId;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function summary(
  state: TradeResearchAggregateEvidenceState,
  explanation: string,
  supportingProviderIds: readonly string[] = [],
  conflictingProviderIds: readonly string[] = [],
): TradeResearchAggregateDimensionSummary {
  return {
    state,
    explanation,
    supportingProviderIds: sortedUnique(supportingProviderIds),
    conflictingProviderIds: sortedUnique(conflictingProviderIds),
  };
}

function assessmentFor(dimension: Exclude<Dimension, "identity">, evidence: TradeResearchProviderEvidence): TradeResearchEvidenceAssessment {
  if (dimension === "product") {
    if ((evidence.productEvidence.state === "verified" || evidence.productEvidence.state === "supporting")
        && evidence.mappingScope.productGrain !== "company_product") {
      return { state: "not_available", explanation: "The source does not support a company-product relationship." };
    }
    return evidence.productEvidence;
  }
  if (dimension === "origin") {
    if ((evidence.originEvidence.state === "verified" || evidence.originEvidence.state === "supporting")
        && evidence.mappingScope.originGrain !== "company_product_origin") {
      return { state: "not_available", explanation: "The source does not support a company-product-origin relationship." };
    }
    return evidence.originEvidence;
  }
  if (dimension === "india_origin") {
    const value = evidence.indiaOriginEvidence ?? { state: "not_verified" as const, explanation: "India origin was not verified by this source." };
    if ((value.state === "verified" || value.state === "supporting")
        && evidence.mappingScope.originGrain !== "company_product_origin") {
      return { state: "not_verified", explanation: "The source does not support India origin for this company-product relationship." };
    }
    return value;
  }
  if (dimension === "shipment") {
    if ((evidence.shipmentEvidence.state === "verified" || evidence.shipmentEvidence.state === "supporting")
        && evidence.mappingScope.shipmentGrain !== "shipment_record") {
      return { state: "not_verified", explanation: "The source does not contain shipment-level records." };
    }
    return evidence.shipmentEvidence;
  }
  if ((evidence.programEvidence.state === "verified" || evidence.programEvidence.state === "supporting")
      && evidence.mappingScope.programGrain !== "company_program") {
    return { state: "not_available", explanation: "The source does not support company-program participation." };
  }
  return evidence.programEvidence;
}

function explicitConflicts(
  dimension: ConflictDimension,
  evaluated: readonly TradeResearchProviderResult[],
): TradeResearchAggregateConflict[] {
  const byDescription = new Map<string, string[]>();
  for (const provider of evaluated) {
    for (const conflict of provider.evidence?.conflicts ?? []) {
      if (conflict.dimension !== dimension) continue;
      byDescription.set(conflict.description, [...(byDescription.get(conflict.description) ?? []), provider.providerId]);
    }
  }
  return [...byDescription.entries()].map(([description, providerIds]) => ({
    dimension,
    providerIds: sortedUnique(providerIds),
    description,
  }));
}

function aggregateDimension(
  dimension: Exclude<Dimension, "identity">,
  evaluated: readonly TradeResearchProviderResult[],
  conflicts: readonly TradeResearchAggregateConflict[],
): TradeResearchAggregateDimensionSummary {
  const relevantConflicts = conflicts.filter((conflict) => conflict.dimension === dimension);
  if (relevantConflicts.length > 0) {
    return summary(
      "conflicting",
      `Evaluated sources contain an explicit ${dimension.replace("_", " ")} contradiction that requires review.`,
      [],
      relevantConflicts.flatMap((conflict) => conflict.providerIds),
    );
  }

  const facts = evaluated.flatMap((provider) => provider.evidence
    ? [{ providerId: provider.providerId, assessment: assessmentFor(dimension, provider.evidence) }]
    : []);
  if (facts.length === 0) return summary("not_evaluated", "No provider was evaluated for this dimension.");

  const ids = (state: string) => facts.filter((fact) => fact.assessment.state === state).map((fact) => fact.providerId);
  const verified = ids("verified");
  const supporting = ids("supporting");
  const review = ids("needs_review");
  const noMatch = ids("no_verified_match");
  const notVerified = ids("not_verified");
  const notAvailable = ids("not_available");

  if (verified.length > 0 && (supporting.length > 0 || review.length > 0)) {
    return summary("needs_review", "Verified and qualified supporting evidence coexist; the weaker source is not promoted.", [...verified, ...supporting, ...review]);
  }
  if (verified.length > 0) {
    return summary("verified", "At least one source explicitly verifies this dimension; source absence is retained without becoming a conflict.", verified);
  }
  if (supporting.length > 0) {
    return summary("supporting", "Only qualified supporting evidence is available for this dimension.", supporting);
  }
  if (review.length > 0) {
    return summary("needs_review", "Provider-local evidence requires review for this dimension.", review);
  }
  if (noMatch.length > 0) {
    return summary("no_verified_match", "Evaluated sources found no verified match for this dimension; this is not proof of absence.", noMatch);
  }
  if (notVerified.length > 0) {
    return summary("not_verified", "Evaluated sources do not verify this dimension.");
  }
  if (notAvailable.length > 0) {
    return summary("not_available", "This dimension is not available from the evaluated sources.");
  }
  return summary("not_evaluated", "No evaluated source produced a usable assessment for this dimension.");
}

function aggregateIdentity(
  evaluated: readonly TradeResearchProviderResult[],
  conflicts: readonly TradeResearchAggregateConflict[],
): TradeResearchAggregateDimensionSummary {
  const exact = evaluated.filter((provider) => provider.evidence
    && (provider.evidence.matchDecision === "exact" || provider.evidence.matchDecision === "strong")
    && provider.evidence.companyEvidence.state === "verified");
  const ambiguous = evaluated.filter((provider) => provider.evidence
    && (provider.evidence.matchDecision === "ambiguous" || provider.evidence.companyEvidence.state === "supporting"));
  const rejected = evaluated.filter((provider) => provider.evidence?.matchDecision === "rejected");
  const noMatch = evaluated.filter((provider) => provider.evidence?.matchDecision === "none"
    || provider.evidence?.companyEvidence.state === "no_verified_match");
  const explicit = conflicts.filter((conflict) => conflict.dimension === "identity");

  if ((exact.length > 0 && rejected.length > 0) || explicit.length > 0) {
    return summary(
      "conflicting",
      "A verified identity and an explicit rejection or contradiction coexist; identity requires review.",
      exact.map((provider) => provider.providerId),
      [...exact, ...rejected].map((provider) => provider.providerId).concat(explicit.flatMap((conflict) => conflict.providerIds)),
    );
  }
  if (exact.length > 0 && ambiguous.length > 0) {
    return summary("needs_review", "Exact and ambiguous identity evidence coexist; the ambiguous source is not promoted.", [...exact, ...ambiguous].map((provider) => provider.providerId));
  }
  if (exact.length > 0) {
    return summary("verified", exact.length > 1 ? "Two or more sources verify the same candidate identity." : "One source verifies the candidate identity.", exact.map((provider) => provider.providerId));
  }
  if (ambiguous.length > 0) {
    return summary("needs_review", "Identity evidence is ambiguous and requires review.", ambiguous.map((provider) => provider.providerId));
  }
  if (noMatch.length > 0 || rejected.length > 0) {
    return summary("no_verified_match", "No evaluated source verified the candidate identity; this is not proof that the company is absent.");
  }
  return summary("not_evaluated", "No provider evaluated candidate identity.");
}

function legacyIdentity(identity: TradeResearchAggregateDimensionSummary, evaluated: number): TradeResearchAggregateResult["identity"] {
  if (identity.state === "conflicting") return "conflicting_evidence";
  if (identity.state === "needs_review" || identity.state === "supporting") return "needs_review";
  if (identity.state === "verified") return identity.supportingProviderIds.length > 1 ? "verified_identity" : "single_source_support";
  if (evaluated === 0) return "no_evidence";
  return "no_evidence";
}

/** Pure, deterministic T09 reducer over authoritative source-local outcomes. */
export function aggregateTradeResearchEvidence(providerResults: readonly TradeResearchProviderResult[]): TradeResearchAggregateResult {
  const evaluated = providerResults.filter((provider) => evaluatedStatuses.has(provider.execution.status) && provider.evidence);
  const statuses = providerResults.map((provider) => provider.execution.status);
  const coverageCounts = {
    planned: providerResults.length,
    evaluated: evaluated.length,
    cached: statuses.filter((status) => status === "cached").length,
    failed: statuses.filter((status) => status === "failed_retryable" || status === "failed_terminal").length,
    unsupported: statuses.filter((status) => status === "unsupported").length,
    blocked: statuses.filter((status) => status === "blocked").length,
    notStarted: statuses.filter((status) => status === "not_started").length,
    cancelled: statuses.filter((status) => status === "cancelled").length,
  };
  const conflicts = (["identity", "product", "origin", "india_origin", "shipment", "program", "coverage"] as const)
    .flatMap((dimension) => explicitConflicts(dimension, evaluated));
  const identityExact = evaluated.filter((provider) => provider.evidence
    && (provider.evidence.matchDecision === "exact" || provider.evidence.matchDecision === "strong")
    && provider.evidence.companyEvidence.state === "verified");
  const identityRejected = evaluated.filter((provider) => provider.evidence?.matchDecision === "rejected");
  if (identityExact.length > 0 && identityRejected.length > 0) {
    conflicts.push({
      dimension: "identity",
      providerIds: sortedUnique([...identityExact, ...identityRejected].map((provider) => provider.providerId)),
      description: "Verified identity evidence conflicts with an explicit rejected identity match.",
    });
  }
  conflicts.sort((a, b) => a.dimension.localeCompare(b.dimension)
    || a.providerIds.join("|").localeCompare(b.providerIds.join("|"))
    || a.description.localeCompare(b.description));

  const identitySummary = aggregateIdentity(evaluated, conflicts);
  const productSummary = aggregateDimension("product", evaluated, conflicts);
  const originSummary = aggregateDimension("origin", evaluated, conflicts);
  const indiaOriginSummary = aggregateDimension("india_origin", evaluated, conflicts);
  const shipmentSummary = aggregateDimension("shipment", evaluated, conflicts);
  const programSummary = aggregateDimension("program", evaluated, conflicts);
  const incomplete = coverageCounts.evaluated < coverageCounts.planned;
  const coverageConflicts = conflicts.filter((conflict) => conflict.dimension === "coverage");
  const coverageSummary = coverageConflicts.length > 0
    ? summary("conflicting", "Provider coverage metadata contains an explicit contradiction.", [], coverageConflicts.flatMap((conflict) => conflict.providerIds))
    : summary(
      coverageCounts.planned === 0 ? "not_evaluated" : incomplete ? "needs_review" : "verified",
      coverageCounts.planned === 0
        ? "No providers were planned."
        : `${coverageCounts.evaluated} of ${coverageCounts.planned} planned sources were evaluated.`,
      evaluated.map((provider) => provider.providerId),
    );
  const families = new Map<string, string[]>();
  for (const provider of providerResults) {
    const family = tradeResearchSourceFamily(provider.providerId);
    families.set(family, [...(families.get(family) ?? []), provider.providerId]);
  }
  const sourceFamilies = [...families.entries()]
    .map(([familyId, providerIds]) => ({ familyId, providerIds: sortedUnique(providerIds) }))
    .sort((a, b) => a.familyId.localeCompare(b.familyId));

  return {
    identity: legacyIdentity(identitySummary, evaluated.length),
    reason: identitySummary.explanation,
    sourcesEvaluated: evaluated.length,
    sourcesCorroborating: new Set(identitySummary.supportingProviderIds.map(tradeResearchSourceFamily)).size,
    identitySummary,
    productSummary,
    originSummary,
    indiaOriginSummary,
    shipmentSummary,
    programSummary,
    coverageSummary,
    coverageCounts,
    sourceFamilies,
    conflicts,
  };
}
