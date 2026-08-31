import { blankToUndefined, normalizeDomain, normalizeOptionalEmail } from "@/lib/buyerFinder/normalize";
import { isSameCompanySite } from "@/lib/buyerFinder/sameSite";
import { emailDomain } from "@/lib/buyerFinder/publicMailbox";
import { isValidEmail } from "@/lib/utils";
import { sanitizeLinkedinProfileUrl } from "@/lib/buyerFinder/linkedinUrl";
import { sanitizePhoneNumber } from "@/lib/buyerFinder/phoneNumber";
import { scoreBuyerCandidate, scoreOneContact } from "@/lib/buyerFinder/scoring";
import { toSafeContact, type SafeBuyerCandidateContact } from "@/lib/buyerFinder/safeContact";
import {
  isRevealEventStale,
  type BuyerFinderContactRevealEvent,
  type ContactRevealProviderOutcome,
} from "@/lib/buyerFinder/contactRevealEvent";
import type { BuyerCandidate, BuyerCandidateContact } from "@/lib/buyerFinder/types";
import type {
  PersonalContactRevealProvider,
  PersonalContactRevealResult,
  RevealedPersonalContactDetails,
} from "@/lib/buyerFinder/providers/types";
import type {
  BuyerCandidateContactRepository,
  BuyerCandidateProductMatchRepository,
  BuyerCandidateRepository,
  BuyerFinderContactRevealEventRepository,
} from "@/lib/repositories/interfaces";
import { RevealEventActiveExistsError } from "@/lib/repositories/interfaces";
import { HunterDiscoveryError } from "@/lib/buyerFinder/providers/hunter/errors";

export type PersonalRevealOutcome =
  | "success"
  | "disabled"
  | "invalid_input"
  | "in_progress"
  | "needs_reconciliation"
  | "stale_or_invalid_provider_ref"
  | "quota_exhausted"
  | "rate_limited"
  | "not_configured"
  | "temporarily_unavailable"
  | "invalid_provider_response"
  | "contract_violation";

export interface PersonalRevealSummary {
  outcome: PersonalRevealOutcome;
  message?: string;
  creditsCharged?: number | null;
  contact?: SafeBuyerCandidateContact;
  overallScore?: number;
  companyFit?: number;
  contactQuality?: number;
  completeness?: number;
  generalEmail?: string;
}

export interface RevealPersonalContactDeps {
  contactId: string;
  now?: () => Date;
  provider: PersonalContactRevealProvider;
  repositories: {
    candidates: BuyerCandidateRepository;
    contacts: BuyerCandidateContactRepository;
    productMatches: BuyerCandidateProductMatchRepository;
    revealEvents: BuyerFinderContactRevealEventRepository;
  };
}

function empty(outcome: PersonalRevealOutcome, message?: string): PersonalRevealSummary {
  return { outcome, message };
}

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function preferLonger(existing: string, incoming: string | undefined): string {
  const next = (incoming ?? "").trim();
  if (!next) return existing;
  const cur = existing.trim();
  if (!cur) return next;
  return next.length >= cur.length ? next : cur;
}

function mergeRevealedNames(
  contact: BuyerCandidateContact,
  person: RevealedPersonalContactDetails,
): Pick<BuyerCandidateContact, "firstName" | "lastName" | "fullName" | "fullNameAvailable"> {
  const firstName = preferLonger(contact.firstName, person.firstName);
  const lastName = preferLonger(contact.lastName, person.lastName);
  const joined = [firstName, lastName].filter(Boolean).join(" ").trim();
  const existingFull = (contact.fullName ?? "").trim();
  let fullName = existingFull;
  if (person.firstName || person.lastName) {
    if (joined && joined.length >= existingFull.length) fullName = joined;
  }
  return {
    firstName,
    lastName,
    fullName,
    fullNameAvailable: Boolean(fullName) || contact.fullNameAvailable,
  };
}

function emailBelongsToCandidate(candidate: BuyerCandidate, email: string): boolean {
  const host = emailDomain(email);
  const domain = normalizeDomain(candidate.domain);
  if (!host || !domain) return false;
  return isSameCompanySite(domain, host);
}

function hunterDomainMatchesCandidate(candidate: BuyerCandidate, hunterDomain: string | undefined): boolean {
  if (!hunterDomain) return false;
  const domain = normalizeDomain(candidate.domain);
  if (!domain) return false;
  return isSameCompanySite(domain, hunterDomain);
}

function validateRevealedPerson(
  candidate: BuyerCandidate,
  person: RevealedPersonalContactDetails | undefined,
): { ok: true; email: string; person: RevealedPersonalContactDetails } | { ok: false; code: string } {
  if (!person) return { ok: false, code: "identity_mismatch" };
  if (person.type !== "personal") return { ok: false, code: "not_personal" };
  const email = normalizeOptionalEmail(person.email);
  if (!email || !isValidEmail(email) || hasControlChars(email)) {
    return { ok: false, code: "invalid_email" };
  }
  if (!emailBelongsToCandidate(candidate, email)) return { ok: false, code: "email_domain_mismatch" };
  if (!hunterDomainMatchesCandidate(candidate, person.domain)) {
    return { ok: false, code: "provider_domain_mismatch" };
  }
  return { ok: true, email, person };
}

function mapProviderOutcome(result: PersonalContactRevealResult): ContactRevealProviderOutcome {
  switch (result.outcome) {
    case "revealed":
      return "revealed";
    case "already_revealed":
      return "already_revealed";
    case "not_found":
      return "not_found";
    case "insufficient_credits":
    case "quota_exhausted":
      return "insufficient_credits";
    case "contract_violation":
    case "invalid_response":
      return "invalid_response";
    default:
      return "provider_error";
  }
}

async function scoreAndPersist(
  deps: RevealPersonalContactDeps,
  candidate: BuyerCandidate,
  updated: BuyerCandidateContact,
): Promise<{ contact: BuyerCandidateContact; scored: ReturnType<typeof scoreBuyerCandidate> }> {
  const scoredContact = scoreOneContact(updated);
  const withScore: BuyerCandidateContact = { ...updated, contactScore: scoredContact.points };
  const persisted = await deps.repositories.contacts.update(withScore.id, {
    firstName: withScore.firstName,
    lastName: withScore.lastName,
    fullName: withScore.fullName,
    fullNameAvailable: withScore.fullNameAvailable,
    jobTitle: withScore.jobTitle,
    businessEmail: withScore.businessEmail,
    linkedinUrl: withScore.linkedinUrl,
    linkedinAvailable: withScore.linkedinAvailable,
    phoneNumber: withScore.phoneNumber,
    phoneAvailable: withScore.phoneAvailable,
    revealedAt: withScore.revealedAt,
    contactScore: withScore.contactScore,
  });

  const [contacts, productMatches] = await Promise.all([
    deps.repositories.contacts.listByCandidate(candidate.id),
    deps.repositories.productMatches.listByCandidate(candidate.id),
  ]);
  const scored = scoreBuyerCandidate({
    candidate,
    contacts,
    productMatches,
    targetProductId: productMatches[0]?.productId,
    targetCountry: candidate.country,
  });
  await deps.repositories.candidates.update(candidate.id, { companyScore: scored.total });
  return { contact: persisted, scored };
}

async function claimEvent(
  deps: RevealPersonalContactDeps,
  candidateId: string,
  contactId: string,
): Promise<
  | { kind: "claimed"; event: BuyerFinderContactRevealEvent }
  | { kind: "in_progress" }
  | { kind: "needs_reconciliation" }
> {
  const latest = await deps.repositories.revealEvents.getLatestForContact(contactId);
  if (latest?.status === "processing") {
    if (isRevealEventStale(latest, deps.now?.().getTime())) {
      await deps.repositories.revealEvents.markReconciliationRequired(latest.id);
      return { kind: "needs_reconciliation" };
    }
    return { kind: "in_progress" };
  }
  if (latest?.status === "pending") {
    const claimed = await deps.repositories.revealEvents.claimProcessing(latest.id);
    if (!claimed) return { kind: "in_progress" };
    return { kind: "claimed", event: claimed };
  }
  if (latest?.status === "reconciliation_required") {
    const claimed = await deps.repositories.revealEvents.claimReconciliation(latest.id);
    if (!claimed) return { kind: "in_progress" };
    return { kind: "claimed", event: claimed };
  }

  try {
    const pending = await deps.repositories.revealEvents.insertPending({
      candidateId,
      contactId,
      provider: "hunter",
    });
    const claimed = await deps.repositories.revealEvents.claimProcessing(pending.id);
    if (!claimed) return { kind: "in_progress" };
    return { kind: "claimed", event: claimed };
  } catch (err) {
    if (err instanceof RevealEventActiveExistsError) return { kind: "in_progress" };
    throw err;
  }
}

/**
 * BF3B — reveal ONE persisted personal Hunter contact.
 *
 * Does not change is_primary. Does not write candidate.general_email.
 * Does not call Email Verifier. Recomputes scores with the existing formula.
 */
export async function revealPersonalContactForCandidate(
  deps: RevealPersonalContactDeps,
): Promise<PersonalRevealSummary> {
  const contact = await deps.repositories.contacts.get(deps.contactId);
  if (!contact) return empty("invalid_input", "Contact not found.");
  const candidate = await deps.repositories.candidates.get(contact.candidateId);
  if (!candidate) return empty("invalid_input", "Candidate not found.");
  if (candidate.discoveryStatus === "archived") {
    return empty("invalid_input", "Archived candidates cannot be revealed.");
  }
  if (candidate.reviewStatus === "rejected") {
    return empty("invalid_input", "Rejected candidates cannot be revealed.");
  }
  if ((contact.source ?? "").toLowerCase() !== "hunter") {
    return empty("invalid_input", "Only Hunter personal contacts can be revealed.");
  }
  if (contact.emailType !== "personal") {
    return empty("invalid_input", "Only personal contacts can be revealed.");
  }
  if (!blankToUndefined(contact.providerRef)) {
    return empty("invalid_input", "This contact has no reveal token. Find decision makers · Free.");
  }
  if (normalizeOptionalEmail(contact.businessEmail)) {
    return empty("invalid_input", "This contact already has an email.");
  }
  if (!normalizeDomain(candidate.domain)) {
    return empty("invalid_input", "This candidate needs a company domain.");
  }

  const claimed = await claimEvent(deps, candidate.id, contact.id);
  if (claimed.kind === "in_progress") {
    return empty("in_progress", "Reveal already in progress.");
  }
  if (claimed.kind === "needs_reconciliation") {
    return empty("needs_reconciliation", "Reveal needs reconciliation.");
  }

  const event = claimed.event;
  const providerRef = contact.providerRef as string;

  let result: PersonalContactRevealResult;
  try {
    result = await deps.provider.reveal({ providerRef });
  } catch (err) {
    if (err instanceof HunterDiscoveryError) {
      const outcome: PersonalRevealOutcome =
        err.code === "unauthorized"
          ? "not_configured"
          : err.code === "forbidden"
            ? "quota_exhausted"
            : err.code === "rate_limited"
              ? "rate_limited"
              : "temporarily_unavailable";
      await deps.repositories.revealEvents.finalize(event.id, {
        status: "failed",
        providerOutcome: "provider_error",
        creditsCharged: 0,
        errorCode: err.code,
      });
      const message =
        outcome === "not_configured"
          ? "Hunter configuration needs attention."
          : outcome === "quota_exhausted"
            ? "Hunter credits unavailable."
            : outcome === "rate_limited"
              ? "Hunter is temporarily rate limited. Try again shortly."
              : "Hunter is temporarily unavailable.";
      return empty(outcome, message);
    }
    await deps.repositories.revealEvents.finalize(event.id, {
      status: "failed",
      providerOutcome: "provider_error",
      creditsCharged: 0,
      errorCode: "provider_error",
    });
    return empty("temporarily_unavailable", "Hunter is temporarily unavailable.");
  }

  if (result.outcome === "not_found") {
    await deps.repositories.revealEvents.finalize(event.id, {
      status: "failed",
      providerOutcome: "not_found",
      creditsCharged: result.creditsCharged ?? 0,
      errorCode: "stale_or_invalid_provider_ref",
    });
    return empty(
      "stale_or_invalid_provider_ref",
      "Contact reveal token expired. Refresh decision makers · Free.",
    );
  }

  if (result.outcome === "insufficient_credits" || result.outcome === "quota_exhausted") {
    await deps.repositories.revealEvents.finalize(event.id, {
      status: "failed",
      providerOutcome: "insufficient_credits",
      creditsCharged: result.creditsCharged ?? 0,
      errorCode: "quota_exhausted",
    });
    return empty("quota_exhausted", "Hunter credits unavailable.");
  }

  if (result.outcome === "rate_limited") {
    await deps.repositories.revealEvents.finalize(event.id, {
      status: "failed",
      providerOutcome: "provider_error",
      creditsCharged: result.creditsCharged ?? 0,
      errorCode: "rate_limited",
    });
    return empty("rate_limited", "Hunter is temporarily rate limited. Try again shortly.");
  }

  if (result.outcome === "contract_violation") {
    await deps.repositories.revealEvents.finalize(event.id, {
      status: "failed",
      providerOutcome: "invalid_response",
      creditsCharged: result.creditsCharged,
      errorCode: "contract_credits_charged",
    });
    return empty("contract_violation", "Hunter returned an unexpected credit charge. Reveal was not saved.");
  }

  if (result.outcome === "invalid_response") {
    await deps.repositories.revealEvents.finalize(event.id, {
      status: "failed",
      providerOutcome: "invalid_response",
      creditsCharged: result.creditsCharged,
      errorCode: "invalid_provider_response",
    });
    return empty("invalid_provider_response", "Hunter returned an unexpected response.");
  }

  if (result.outcome !== "revealed" && result.outcome !== "already_revealed") {
    await deps.repositories.revealEvents.finalize(event.id, {
      status: "failed",
      providerOutcome: "provider_error",
      creditsCharged: result.creditsCharged,
      errorCode: "unexpected_outcome",
    });
    return empty("temporarily_unavailable", "Hunter is temporarily unavailable.");
  }

  const validated = validateRevealedPerson(candidate, result.person);
  if (!validated.ok) {
    await deps.repositories.revealEvents.finalize(event.id, {
      status: "failed",
      providerOutcome: "invalid_response",
      creditsCharged: result.creditsCharged,
      errorCode: validated.code,
    });
    return empty("invalid_provider_response", "Hunter returned contact details that did not match this company.");
  }

  const names = mergeRevealedNames(contact, validated.person);
  const linkedinUrl = sanitizeLinkedinProfileUrl(validated.person.linkedinUrl);
  const phoneNumber = sanitizePhoneNumber(validated.person.phoneNumber);
  const jobTitle = blankToUndefined(validated.person.position) ?? contact.jobTitle;
  const now = (deps.now?.() ?? new Date()).toISOString();

  const merged: BuyerCandidateContact = {
    ...contact,
    ...names,
    jobTitle,
    businessEmail: validated.email,
    linkedinUrl: linkedinUrl ?? contact.linkedinUrl,
    linkedinAvailable: linkedinUrl ? true : contact.linkedinAvailable,
    phoneNumber: phoneNumber ?? contact.phoneNumber,
    phoneAvailable: phoneNumber ? true : contact.phoneAvailable,
    revealedAt: now,
  };

  try {
    const { contact: persisted, scored } = await scoreAndPersist(deps, candidate, merged);
    await deps.repositories.revealEvents.finalize(event.id, {
      status: "succeeded",
      providerOutcome: mapProviderOutcome(result),
      creditsCharged: result.creditsCharged,
    });
    return {
      outcome: "success",
      creditsCharged: result.creditsCharged,
      contact: toSafeContact(persisted),
      overallScore: scored.total,
      companyFit: scored.companyFit,
      contactQuality: scored.contactQuality,
      completeness: scored.completeness,
      generalEmail: candidate.generalEmail,
      message:
        result.outcome === "already_revealed" || result.creditsCharged === 0
          ? `Contact revealed · ${result.creditsCharged ?? 0} credits used. Already revealed this billing period.`
          : `Contact revealed · ${result.creditsCharged ?? 0} Hunter credit${result.creditsCharged === 1 ? "" : "s"} used.`,
    };
  } catch {
    await deps.repositories.revealEvents.finalize(event.id, {
      status: "reconciliation_required",
      providerOutcome: mapProviderOutcome(result),
      creditsCharged: result.creditsCharged,
      errorCode: "persist_failed",
    });
    return empty("needs_reconciliation", "Reveal needs reconciliation.");
  }
}
