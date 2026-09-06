import { normalizeValidBuyerEmail } from "@/lib/buyerEmail";
import type { Buyer } from "@/lib/types";
import type { CandidateConversion } from "@/lib/buyerFinder/conversion";
import type {
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidatePublicEmail,
} from "@/lib/buyerFinder/types";
import type { OutreachReadinessResult } from "./types";

export const OUTREACH_READINESS_CALCULATION_VERSION = "bi2-readiness-v1";

export interface OutreachReadinessInput {
  candidate: BuyerCandidate;
  contacts: BuyerCandidateContact[];
  publicEmails: BuyerCandidatePublicEmail[];
  conversion?: CandidateConversion;
  buyer?: Buyer;
}

function hasUsableCandidateEmail(input: OutreachReadinessInput): boolean {
  return (
    input.contacts.some(
      (row) =>
        Boolean(row.revealedAt) &&
        row.emailType === "personal" &&
        Boolean(normalizeValidBuyerEmail(row.businessEmail)),
    ) ||
    input.publicEmails.some((row) => Boolean(normalizeValidBuyerEmail(row.email)))
  );
}

export function calculateOutreachReadiness(
  input: OutreachReadinessInput,
): OutreachReadinessResult {
  // A conversion is authoritative: archiving the preserved research record
  // does not suppress or invalidate its already-created Buyer.
  if (input.conversion) {
    if (!input.buyer) {
      return result("needs_contact", "The converted Buyer record could not be loaded.");
    }
    if (input.buyer.suppressed) {
      return result("suppressed", "The linked Buyer is suppressed from outreach.");
    }
    if (normalizeValidBuyerEmail(input.buyer.email)) {
      return result(
        "ready_for_outreach",
        "The linked Buyer has a usable email and is not suppressed; sending remains separately gated.",
      );
    }
    return result("needs_contact", "The linked Buyer has no structurally usable email.");
  }

  if (
    input.candidate.reviewStatus === "rejected" ||
    input.candidate.discoveryStatus === "archived"
  ) {
    return result("not_eligible", "The Candidate is rejected or its research record is archived.");
  }
  if (input.candidate.reviewStatus !== "approved") {
    return result("needs_review", "The Candidate has not been approved for Buyer review.");
  }
  if (!hasUsableCandidateEmail(input)) {
    return result("needs_contact", "The approved Candidate has no usable persisted email route.");
  }
  return result(
    "ready_for_conversion",
    "The approved Candidate has a usable persisted email and has not been converted.",
  );
}

function result(
  classification: OutreachReadinessResult["classification"],
  summary: string,
): OutreachReadinessResult {
  return {
    classification,
    summary,
    components: [{ key: "lifecycle", explanation: summary, evidenceCount: 0 }],
    evidence: [],
  };
}
