/**
 * BF3A — free masked person discovery orchestration.
 *
 * One explicit operator click → one provider request → local domain
 * filter → rank → persist a bounded set. No pagination. No email reveal.
 *
 * Concurrency: the server action holds an in-memory `busyCandidates` set
 * so a double-click cannot start a second Hunter request for the same
 * candidate in this process.
 *
 * Person identity is a candidate-scoped fingerprint of masked metadata.
 * `providerRef` (Hunter reveal_handle) is an opaque CURRENT provider
 * reference for a future server-side reveal — it may rotate and is not
 * the permanent MDF person identity.
 *
 * A durable Person Search Run table is not justified yet — this is a
 * single request/response, not a background job.
 */

import "server-only";

import type { BuyerCandidateContactRepository, BuyerCandidateRepository } from "@/lib/repositories/interfaces";
import { newEntityId } from "./ids";
import { blankToUndefined, normalizeDomain } from "./normalize";
import {
  comparePeopleForPrimary,
  PERSON_PERSIST_CAP,
  type RankablePerson,
} from "./personRank";
import type { PersonDiscoveryProvider } from "./providers/types";
import { personFingerprint } from "./personIdentity";
import { scoreBuyerCandidate, scoreOneContact } from "./scoring";
import { normalizeCandidateSource } from "./source";
import type {
  BusinessProductId,
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidateProductMatch,
} from "./types";

export const PERSON_DISCOVERY_REQUEST_LIMIT = 25;

export interface PersonDiscoveryRepos {
  candidates: BuyerCandidateRepository;
  contacts: BuyerCandidateContactRepository;
}

export interface DiscoverPeopleForCandidateInput {
  candidate: BuyerCandidate;
  productMatches: BuyerCandidateProductMatch[];
  targetProductId?: BusinessProductId;
  provider: PersonDiscoveryProvider;
  repositories: PersonDiscoveryRepos;
  now?: () => Date;
}

export interface PersonDiscoveryBatchResult {
  discovered: number;
  acceptedSameDomain: number;
  discardedOtherDomain: number;
  persisted: number;
  updatedExisting: number;
  hasMore: boolean;
  contacts: BuyerCandidateContact[];
}

function toRankable(contact: BuyerCandidateContact): RankablePerson {
  return {
    jobTitle: contact.jobTitle,
    isDecisionMaker: contact.isDecisionMaker,
    seniority: contact.seniority,
    fullName: contact.fullName,
    providerRef: contact.providerRef,
  };
}

function applyPrimary(contacts: BuyerCandidateContact[]): BuyerCandidateContact[] {
  if (contacts.length === 0) return contacts;
  const ranked = [...contacts].sort((a, b) => {
    const sa = a.contactScore ?? 0;
    const sb = b.contactScore ?? 0;
    if (sb !== sa) return sb - sa;
    return comparePeopleForPrimary(toRankable(a), toRankable(b));
  });
  const primaryId = ranked[0]!.id;
  return contacts.map((c) => ({ ...c, isPrimary: c.id === primaryId }));
}

function fingerprintForContact(
  contact: BuyerCandidateContact,
  domain: string,
): string {
  return personFingerprint({
    candidateId: contact.candidateId,
    domain,
    maskedName: contact.fullName,
    position: contact.jobTitle,
  });
}

/**
 * Demote the previous primary first, then promote the selected one.
 * Required by buyer_candidate_contacts_one_primary_per_candidate_idx.
 */
async function persistPrimaryAssignment(
  desired: BuyerCandidateContact[],
  previous: BuyerCandidateContact[],
  repo: BuyerCandidateContactRepository,
): Promise<void> {
  const desiredPrimaryId = desired.find((c) => c.isPrimary)?.id;
  const previousPrimaries = previous.filter((c) => c.isPrimary);

  for (const row of previousPrimaries) {
    if (row.id !== desiredPrimaryId) {
      await repo.update(row.id, { isPrimary: false });
    }
  }

  if (desiredPrimaryId) {
    const alreadyPrimary = previous.some((c) => c.id === desiredPrimaryId && c.isPrimary);
    if (!alreadyPrimary) {
      await repo.update(desiredPrimaryId, { isPrimary: true });
    }
  }
}

/**
 * Persist masked people for one candidate. Loads only this candidate's
 * contacts — never the whole workspace.
 */
export async function discoverPeopleForCandidate(
  input: DiscoverPeopleForCandidateInput,
): Promise<PersonDiscoveryBatchResult> {
  const domain = normalizeDomain(input.candidate.domain);
  const companyName = blankToUndefined(input.candidate.companyName);
  if (!domain) {
    throw new Error("Candidate domain is required for person discovery.");
  }
  if (!companyName) {
    throw new Error("Candidate company name is required for person discovery.");
  }

  const found = await input.provider.findPeople({
    companyName,
    domain,
    limit: PERSON_DISCOVERY_REQUEST_LIMIT,
  });

  const sameDomain = found.people.filter((p) => normalizeDomain(p.domain) === domain);
  const discardedOtherDomain = found.people.length - sameDomain.length;

  const existing = await input.repositories.contacts.listByCandidate(input.candidate.id);
  const byFingerprint = new Map<string, BuyerCandidateContact>(
    existing.map((c) => [fingerprintForContact(c, domain), c]),
  );
  const byRef = new Map<string, BuyerCandidateContact>(
    existing
      .filter((c) => Boolean(c.source) && Boolean(c.providerRef))
      .map((c) => [`${c.source}:${c.providerRef}`, c]),
  );

  const rankedIncoming = [...sameDomain]
    .sort((a, b) =>
      comparePeopleForPrimary(
        {
          jobTitle: a.position,
          isDecisionMaker: a.decisionMaker,
          seniority: a.seniority,
          fullName: a.maskedName,
          providerRef: a.providerRef,
        },
        {
          jobTitle: b.position,
          isDecisionMaker: b.decisionMaker,
          seniority: b.seniority,
          fullName: b.maskedName,
          providerRef: b.providerRef,
        },
      ),
    )
    .slice(0, PERSON_PERSIST_CAP);

  let persisted = 0;
  let updatedExisting = 0;
  const nowIso = (input.now ?? (() => new Date()))().toISOString();
  const upserted: BuyerCandidateContact[] = [];

  for (const person of rankedIncoming) {
    const source = normalizeCandidateSource(person.source);
    const personDomain = normalizeDomain(person.domain) ?? domain;
    const fingerprint = personFingerprint({
      candidateId: input.candidate.id,
      domain: personDomain,
      maskedName: person.maskedName,
      position: person.position,
    });
    const refKey = person.providerRef ? `${source}:${person.providerRef}` : "";
    // Primary identity = fingerprint. provider_ref is a secondary reuse
    // key so the same current handle never creates a second row. A new
    // handle for the same fingerprint rotates onto the existing row.
    const existingRow =
      (refKey ? byRef.get(refKey) : undefined) ?? byFingerprint.get(fingerprint);

    const draft: BuyerCandidateContact = {
      id: existingRow?.id ?? newEntityId(),
      candidateId: input.candidate.id,
      firstName: person.firstName ?? "",
      lastName: person.lastName ?? "",
      fullName: person.maskedName,
      jobTitle: person.position,
      businessEmail: existingRow?.businessEmail ?? "",
      linkedinUrl: existingRow?.linkedinUrl,
      isPrimary: false,
      source,
      providerRef: person.providerRef,
      department: person.department,
      seniority: person.seniority,
      isDecisionMaker: person.decisionMaker,
      emailType: person.emailType,
      verificationStatus: person.verificationStatus,
      fullNameAvailable: person.fullNameAvailable,
      linkedinAvailable: person.linkedinAvailable,
      phoneAvailable: person.phoneAvailable,
      evidence: person.evidence,
      discoveredAt: existingRow?.discoveredAt ?? nowIso,
    };
    draft.contactScore = scoreOneContact(draft).points;

    if (existingRow) {
      await input.repositories.contacts.update(existingRow.id, {
        firstName: draft.firstName,
        lastName: draft.lastName,
        fullName: draft.fullName,
        jobTitle: draft.jobTitle,
        businessEmail: draft.businessEmail,
        linkedinUrl: draft.linkedinUrl,
        contactScore: draft.contactScore,
        source: draft.source,
        providerRef: draft.providerRef,
        department: draft.department,
        seniority: draft.seniority,
        isDecisionMaker: draft.isDecisionMaker,
        emailType: draft.emailType,
        verificationStatus: draft.verificationStatus,
        fullNameAvailable: draft.fullNameAvailable,
        linkedinAvailable: draft.linkedinAvailable,
        phoneAvailable: draft.phoneAvailable,
        evidence: draft.evidence,
      });
      updatedExisting += 1;
      const merged = { ...existingRow, ...draft, id: existingRow.id };
      upserted.push(merged);
      const previousFp = fingerprintForContact(existingRow, domain);
      if (previousFp !== fingerprint) byFingerprint.delete(previousFp);
      byFingerprint.set(fingerprint, merged);
      if (existingRow.source && existingRow.providerRef) {
        byRef.delete(`${existingRow.source}:${existingRow.providerRef}`);
      }
      if (refKey) byRef.set(refKey, merged);
    } else {
      await input.repositories.contacts.create(draft);
      persisted += 1;
      upserted.push(draft);
      byFingerprint.set(fingerprint, draft);
      if (refKey) byRef.set(refKey, draft);
    }
  }

  const mergedById = new Map<string, BuyerCandidateContact>();
  for (const row of existing) mergedById.set(row.id, row);
  for (const row of upserted) mergedById.set(row.id, row);
  const withPrimary = applyPrimary([...mergedById.values()]);
  await persistPrimaryAssignment(withPrimary, existing, input.repositories.contacts);

  const contacts = await input.repositories.contacts.listByCandidate(input.candidate.id);
  const score = scoreBuyerCandidate({
    candidate: input.candidate,
    contacts,
    productMatches: input.productMatches,
    targetProductId: input.targetProductId,
    targetCountry: input.candidate.country,
  });
  await input.repositories.candidates.update(input.candidate.id, {
    companyScore: score.total,
    peopleSearchedAt: nowIso,
    peopleHasMore: found.hasMore,
    discoveryStatus: input.candidate.discoveryStatus === "archived" ? "archived" : "ready",
  });

  return {
    discovered: found.people.length,
    acceptedSameDomain: sameDomain.length,
    discardedOtherDomain,
    persisted,
    updatedExisting,
    hasMore: found.hasMore,
    contacts,
  };
}
