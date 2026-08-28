/**
 * BF3A — free masked person discovery orchestration.
 *
 * One explicit operator click → one provider request → local domain
 * filter → rank → persist a bounded set. No pagination. No email reveal.
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

function fallbackKey(candidateId: string, domain: string, fullName: string, jobTitle: string): string {
  return `${candidateId}::${domain}::${fullName.trim().toLowerCase()}::${jobTitle.trim().toLowerCase()}`;
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
  const byRef = new Map(
    existing
      .filter((c) => c.source && c.providerRef)
      .map((c) => [`${c.source}:${c.providerRef}`, c] as const),
  );
  const byFallback = new Map(
    existing.map((c) => [
      fallbackKey(c.candidateId, domain, c.fullName, c.jobTitle),
      c,
    ] as const),
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
    const refKey = person.providerRef ? `${source}:${person.providerRef}` : "";
    const existingRow =
      (refKey ? byRef.get(refKey) : undefined) ??
      byFallback.get(fallbackKey(input.candidate.id, domain, person.maskedName, person.position));

    const draft: BuyerCandidateContact = {
      id: existingRow?.id ?? newEntityId(),
      candidateId: input.candidate.id,
      firstName: person.firstName ?? "",
      lastName: person.lastName ?? "",
      fullName: person.maskedName,
      jobTitle: person.position,
      businessEmail: "",
      linkedinUrl: undefined,
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
        businessEmail: "",
        linkedinUrl: undefined,
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
      upserted.push({ ...existingRow, ...draft, id: existingRow.id });
    } else {
      await input.repositories.contacts.create(draft);
      persisted += 1;
      upserted.push(draft);
    }
  }

  const mergedById = new Map<string, BuyerCandidateContact>();
  for (const row of existing) mergedById.set(row.id, row);
  for (const row of upserted) mergedById.set(row.id, row);
  const withPrimary = applyPrimary([...mergedById.values()]);

  for (const row of withPrimary) {
    const prev = existing.find((c) => c.id === row.id);
    if (!prev || prev.isPrimary !== row.isPrimary) {
      await input.repositories.contacts.update(row.id, { isPrimary: row.isPrimary });
    }
  }

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
