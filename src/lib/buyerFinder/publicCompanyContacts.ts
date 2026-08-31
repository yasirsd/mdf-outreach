/**
 * BF3A.5 — persist public company emails discovered on the company's website.
 *
 * One explicit operator click → bounded fetch → rank → upsert by
 * (candidate, normalized email). Does not delete previously found emails
 * if a later crawl misses them. Does not write buyer_candidate_contacts.
 *
 * general_email on the candidate is the company mailbox. When a primary
 * public email is selected, it is mirrored there so existing completeness
 * scoring can honestly reflect a published company address.
 */

import "server-only";

import type {
  BuyerCandidatePublicEmailRepository,
  BuyerCandidateRepository,
} from "@/lib/repositories/interfaces";
import { newEntityId } from "./ids";
import { normalizeDomain, normalizeOptionalEmail } from "./normalize";
import { persistableSourceUrl } from "./ssrf";
import {
  classifyMailboxKind,
  classifyMailboxType,
  comparePublicEmails,
  pageQualityFromUrl,
  selectPrimaryPublicEmail,
} from "./publicMailbox";
import type { CompanyContactDiscoveryProvider } from "./providers/types";
import { logPublicWebsiteLookupDev } from "./publicWebsiteDiagnostics";
import { scoreBuyerCandidate } from "./scoring";
import type {
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidateProductMatch,
  BuyerCandidatePublicEmail,
} from "./types";

export const PUBLIC_EMAIL_PERSIST_CAP = 8;

function websiteHrefKey(href: string): string {
  try {
    const url = new URL(href);
    const path = url.pathname.replace(/\/$/, "") || "/";
    return `${url.protocol}//${url.hostname.toLowerCase()}${path}`;
  } catch {
    return href.replace(/\/$/, "").toLowerCase();
  }
}

export interface PublicCompanyContactRepos {
  candidates: BuyerCandidateRepository;
  publicEmails: BuyerCandidatePublicEmailRepository;
}

export interface DiscoverPublicCompanyContactsInput {
  candidate: BuyerCandidate;
  contacts: BuyerCandidateContact[];
  productMatches: BuyerCandidateProductMatch[];
  provider: CompanyContactDiscoveryProvider;
  repositories: PublicCompanyContactRepos;
  now?: () => Date;
}

export interface PublicCompanyContactBatchResult {
  outcome: "ok" | "no_result" | "incomplete" | "unavailable" | "blocked" | "timeout" | "invalid_input";
  discovered: number;
  persisted: number;
  updatedExisting: number;
  pagesFetched: number;
  emails: BuyerCandidatePublicEmail[];
}

async function persistPrimaryPublicEmail(
  desired: BuyerCandidatePublicEmail[],
  previous: BuyerCandidatePublicEmail[],
  repo: BuyerCandidatePublicEmailRepository,
): Promise<void> {
  const desiredPrimaryId = desired.find((e) => e.isPrimary)?.id;
  for (const row of previous.filter((e) => e.isPrimary)) {
    if (row.id !== desiredPrimaryId) {
      await repo.update(row.id, { isPrimary: false });
    }
  }
  if (desiredPrimaryId) {
    const already = previous.some((e) => e.id === desiredPrimaryId && e.isPrimary);
    if (!already) {
      await repo.update(desiredPrimaryId, { isPrimary: true });
    }
  }
}

export async function discoverPublicCompanyContactsForCandidate(
  input: DiscoverPublicCompanyContactsInput,
): Promise<PublicCompanyContactBatchResult> {
  const found = await input.provider.discover({
    candidateId: input.candidate.id,
    website: input.candidate.website,
    domain: input.candidate.domain,
  });

  logPublicWebsiteLookupDev({
    candidateId: input.candidate.id,
    hostname:
      normalizeDomain(input.candidate.domain) ?? normalizeDomain(input.candidate.website) ?? "",
    rankedPagePaths: found.rankedPagePaths ?? [],
    selectedPagePaths: found.selectedPagePaths ?? [],
    preferredOrigin: found.preferredOrigin,
    alternateOriginAttempted: found.alternateOriginAttempted,
    observedWorkingOrigin: found.observedWorkingOrigin,
    staticClientRedirectsDiscovered: found.staticClientRedirectsDiscovered,
    selectedClientRedirect: found.selectedClientRedirect,
    clientRedirectAttempted: found.clientRedirectAttempted,
    clientRedirectOutcome: found.clientRedirectOutcome,
    outcome: found.outcome,
    emailCount: found.emails.length,
    pageAttempts: found.pageAttempts ?? [],
  });

  const existingEmails = await input.repositories.publicEmails.listByCandidate(input.candidate.id);
  const usableHits = found.emails.length > 0;
  const completedNoResult = found.outcome === "no_result";

  if (!usableHits && !completedNoResult) {
    return {
      outcome: found.outcome,
      discovered: 0,
      persisted: 0,
      updatedExisting: 0,
      pagesFetched: found.pagesFetched,
      emails: existingEmails,
    };
  }

  const nowIso = (input.now ?? (() => new Date()))().toISOString();
  const existing = existingEmails;
  const byEmail = new Map(
    existing.map((row) => [normalizeOptionalEmail(row.email) ?? row.email.toLowerCase(), row]),
  );
  const scopeDomain =
    normalizeDomain(input.candidate.domain) ?? normalizeDomain(input.candidate.website) ?? "";

  const rankedIncoming = [...found.emails].sort(comparePublicEmails).slice(0, PUBLIC_EMAIL_PERSIST_CAP);

  let persisted = 0;
  let updatedExisting = 0;
  const upserted: BuyerCandidatePublicEmail[] = [];

  for (const hit of rankedIncoming) {
    const email = normalizeOptionalEmail(hit.email);
    if (!email) continue;
    const sourceUrl = persistableSourceUrl(hit.sourceUrl, scopeDomain);
    if (!sourceUrl) continue;
    const prev = byEmail.get(email);
    const mailboxType = classifyMailboxType(email);
    const mailboxKind = classifyMailboxKind(email, input.candidate.domain);
    if (prev) {
      const prevQ = pageQualityFromUrl(prev.sourceUrl);
      const nextQ = hit.pageQuality;
      const patch: Partial<BuyerCandidatePublicEmail> = {
        mailboxType,
        mailboxKind,
      };
      if (nextQ < prevQ) {
        patch.sourceUrl = sourceUrl;
      }
      await input.repositories.publicEmails.update(prev.id, patch);
      const merged = {
        ...prev,
        ...patch,
        sourceUrl: patch.sourceUrl ?? prev.sourceUrl,
      };
      upserted.push(merged);
      byEmail.set(email, merged);
      updatedExisting += 1;
    } else {
      const row: BuyerCandidatePublicEmail = {
        id: newEntityId(),
        candidateId: input.candidate.id,
        email,
        mailboxType,
        mailboxKind,
        source: "company_website",
        sourceUrl,
        isPrimary: false,
        discoveredAt: nowIso,
      };
      await input.repositories.publicEmails.create(row);
      upserted.push(row);
      byEmail.set(email, row);
      persisted += 1;
    }
  }

  const mergedById = new Map<string, BuyerCandidatePublicEmail>();
  for (const row of existing) mergedById.set(row.id, row);
  for (const row of upserted) mergedById.set(row.id, row);
  const all = [...mergedById.values()];
  const primary = selectPrimaryPublicEmail(
    all.map((e) => ({
      ...e,
      pageQuality: pageQualityFromUrl(e.sourceUrl),
    })),
  );
  const withPrimary = all.map((e) => ({ ...e, isPrimary: e.id === primary?.id }));
  await persistPrimaryPublicEmail(withPrimary, existing, input.repositories.publicEmails);

  const emails = await input.repositories.publicEmails.listByCandidate(input.candidate.id);
  const chosen = emails.find((e) => e.isPrimary) ?? selectPrimaryPublicEmail(emails);

  const candidatePatch: Partial<BuyerCandidate> = {
    publicContactsSearchedAt: nowIso,
    discoveryStatus: input.candidate.discoveryStatus === "archived" ? "archived" : "ready",
  };
  if (chosen?.email) {
    candidatePatch.generalEmail = chosen.email;
  }
  if (found.observedWorkingOrigin) {
    const safeSite = persistableSourceUrl(found.observedWorkingOrigin, scopeDomain);
    if (safeSite) {
      const currentHref =
        persistableSourceUrl(input.candidate.website ?? "", scopeDomain) ??
        persistableSourceUrl(`https://${(input.candidate.website ?? "").replace(/^\/+/, "")}`, scopeDomain);
      const currentKey = currentHref ? websiteHrefKey(currentHref) : undefined;
      const nextKey = websiteHrefKey(safeSite);
      if (currentKey !== nextKey) {
        candidatePatch.website = safeSite;
      }
    }
  }

  const updatedCandidate = { ...input.candidate, ...candidatePatch };
  const score = scoreBuyerCandidate({
    candidate: updatedCandidate,
    contacts: input.contacts,
    productMatches: input.productMatches,
    targetProductId: input.productMatches[0]?.productId,
    targetCountry: updatedCandidate.country,
  });
  candidatePatch.companyScore = score.total;
  await input.repositories.candidates.update(input.candidate.id, candidatePatch);

  return {
    outcome: emails.length > 0 ? "ok" : "no_result",
    discovered: found.emails.length,
    persisted,
    updatedExisting,
    pagesFetched: found.pagesFetched,
    emails,
  };
}
