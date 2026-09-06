import { normalizeValidBuyerEmail } from "@/lib/buyerEmail";
import type {
  BuyerIntelligenceClaim,
  BuyerIntelligenceSource,
  BuyerTradeObservation,
  ContactAccessInput,
  ContactAccessLevel,
  LegitimacyResult,
} from "./types";

export const LEGITIMACY_CALCULATION_VERSION = "bi2-legitimacy-v1";

export function calculateBasicLegitimacy(input: {
  claims: BuyerIntelligenceClaim[];
  observations: BuyerTradeObservation[];
  sources?: BuyerIntelligenceSource[];
}): LegitimacyResult {
  const verified = input.observations.filter(
    (row) =>
      row.evidenceLevel === 1 &&
      (row.granularity === "shipment" || row.granularity === "transaction"),
  );
  if (verified.length > 0) {
    return {
      classification: "verified",
      summary: "Verified company-specific trade evidence is recorded.",
      components: [
        {
          key: "verified_trade",
          explanation: `${verified.length} verified shipment or transaction record${verified.length === 1 ? "" : "s"}.`,
          evidenceCount: verified.length,
        },
      ],
      evidence: verified.map((row) => ({ kind: "observation" as const, id: row.id })),
    };
  }

  const businessEvidence = [
    ...input.claims
      .filter((row) => row.evidenceLevel === 2)
      .map((row) => ({ kind: "claim" as const, id: row.id, sourceId: row.sourceId })),
    ...input.observations
      .filter((row) => row.evidenceLevel === 2)
      .map((row) => ({ kind: "observation" as const, id: row.id, sourceId: row.sourceId })),
  ];
  const providersBySource = new Map(
    (input.sources ?? []).map((source) => [source.id, source.providerId]),
  );
  // BI2 independence is deliberately conservative: when source envelopes
  // are available, repeated records from one provider count as one source.
  // Domain-only callers without envelopes retain source-id independence.
  const independentSources = new Set(
    businessEvidence.map((row) => providersBySource.get(row.sourceId) ?? row.sourceId),
  ).size;
  if (independentSources >= 2) {
    return {
      classification: "strong_evidence",
      summary: "Multiple independent business sources corroborate this company.",
      components: [
        {
          key: "business_corroboration",
          explanation: `${independentSources} independent business-evidence sources.`,
          evidenceCount: businessEvidence.length,
        },
      ],
      evidence: businessEvidence.map(({ kind, id }) => ({ kind, id })),
    };
  }
  if (businessEvidence.length > 0) {
    return {
      classification: "moderate_evidence",
      summary: "Business evidence exists, but verified trade evidence was not found.",
      components: [
        {
          key: "business_evidence",
          explanation: "At least one Level 2 business source supports the company profile.",
          evidenceCount: businessEvidence.length,
        },
      ],
      evidence: businessEvidence.map(({ kind, id }) => ({ kind, id })),
    };
  }

  const discoverySignals = [
    ...input.claims
      .filter((row) => row.evidenceLevel === 3)
      .map((row) => ({ kind: "claim" as const, id: row.id })),
    ...input.observations
      .filter((row) => row.evidenceLevel === 3)
      .map((row) => ({ kind: "observation" as const, id: row.id })),
  ];
  if (discoverySignals.length > 0) {
    return {
      classification: "weak_signal",
      summary: "Only discovery signals are recorded; trade activity is not verified.",
      components: [
        {
          key: "discovery_signal",
          explanation: "Level 3 discovery evidence requires corroboration.",
          evidenceCount: discoverySignals.length,
        },
      ],
      evidence: discoverySignals,
    };
  }

  return {
    classification: "no_evidence_found",
    summary: "No Buyer Intelligence evidence has been recorded yet.",
    components: [],
    evidence: [],
  };
}

export function classifyContactAccess(input: ContactAccessInput): ContactAccessLevel {
  const validContacts = input.contacts.filter((contact) =>
    Boolean(normalizeValidBuyerEmail(contact.businessEmail)),
  );
  if (
    validContacts.some(
      (contact) =>
        contact.revealedAt &&
        contact.source?.toLowerCase() === "hunter" &&
        contact.emailType === "personal",
    )
  ) {
    return "credit_enriched";
  }
  if (validContacts.length > 0) return "direct_contact";

  const hasNamedContact = input.contacts.some((contact) =>
    Boolean(
      contact.fullName?.trim() ||
        contact.firstName?.trim() ||
        contact.lastName?.trim() ||
        contact.jobTitle?.trim(),
    ),
  );
  if (hasNamedContact) return "named_contact";

  const hasPublicRoute =
    input.publicEmails.some((email) => Boolean(normalizeValidBuyerEmail(email.email))) ||
    Boolean(normalizeValidBuyerEmail(input.candidateGeneralEmail));
  return hasPublicRoute ? "public_route" : "company_only";
}
