/**
 * BF5A — Candidate → Buyer conversion domain.
 *
 * Mapping and eligibility live here so preview and the atomic convert
 * path share one source of truth. The Postgres RPC re-loads the same
 * persisted fields; this module never talks to Hunter, Gmail, or campaigns.
 */

import type { Buyer } from "@/lib/types";
import { normalizeValidBuyerEmail } from "@/lib/buyerEmail";
import { findBusinessProductById } from "./businessCatalogue";
import {
  normalizeCompanyNameForCompare,
  isPublicEmailDomain,
} from "./dedupe";
import { newEntityId } from "./ids";
import { blankToUndefined, normalizeDomain, normalizeOptionalEmail } from "./normalize";
import type {
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidateProductMatch,
  BuyerCandidatePublicEmail,
} from "./types";

export const BUYER_FINDER_BUYER_SOURCE = "Buyer Finder";

export type ConversionSourceKind =
  | "revealed_personal_contact"
  | "public_company_email"
  | "company_only";

export type ConversionEligibilityReason =
  | "ok"
  | "not_found"
  | "not_approved"
  | "rejected"
  | "archived"
  | "already_converted"
  | "invalid_selection";

export type ConversionPreviewReason =
  | "ready"
  | "not_found"
  | "not_approved"
  | "missing_email"
  | "unsupported_email_source"
  | "invalid_candidate_state"
  | "already_converted"
  | "duplicate_buyer"
  | "invalid_selection";

export interface CandidateConversion {
  id: string;
  candidateId: string;
  buyerId: string;
  sourceKind: ConversionSourceKind;
  contactId?: string;
  publicEmailId?: string;
  createdAt: string;
}

export interface ConversionSelectionInput {
  kind?: ConversionSourceKind;
  contactId?: string;
  publicEmailId?: string;
}

export interface ConversionContactOption {
  kind: "revealed_personal_contact";
  contactId: string;
  label: string;
  title?: string;
  email: string;
  selectable: true;
}

export interface ConversionMaskedOption {
  kind: "masked_person";
  contactId: string;
  label: string;
  title?: string;
  selectable: false;
  reason:
    | "Personal email not revealed"
    | "Only revealed personal email can be used"
    | "A valid personal email is required";
}

export interface ConversionPublicEmailOption {
  kind: "public_company_email";
  publicEmailId: string;
  email: string;
  selectable: true;
}

export type ConversionOption =
  | ConversionContactOption
  | ConversionMaskedOption
  | ConversionPublicEmailOption;

export type ConversionDuplicateClass = "none" | "definite" | "possible";

export interface ConversionDuplicateMatch {
  class: Exclude<ConversionDuplicateClass, "none">;
  buyerId: string;
  company: string;
  email: string;
  website?: string;
  reason: "email" | "domain" | "company_name";
}

export interface ConversionMapping {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone?: string;
  website?: string;
  country: string;
  city?: string;
  productInterest?: string;
  source: typeof BUYER_FINDER_BUYER_SOURCE;
  /** Always omitted — search intent is not a Buyer fact. */
  buyerType?: undefined;
  notes?: undefined;
}

export interface ConversionPreview {
  canConvert: boolean;
  reason: ConversionPreviewReason;
  eligibility: ConversionEligibilityReason;
  candidateId: string;
  companyName: string;
  country: string;
  websiteLabel?: string;
  mapping: ConversionMapping;
  sourceKind: ConversionSourceKind;
  options: ConversionOption[];
  selected: ConversionSelectionInput;
  duplicate: ConversionDuplicateClass;
  duplicateMatch?: ConversionDuplicateMatch;
  missingEmail: boolean;
  createBlocked: boolean;
}

export type ConvertOutcome =
  | "created"
  | "already_converted"
  | "duplicate"
  | "not_eligible"
  | "not_found"
  | "invalid_selection"
  | "conflict";

export interface ConvertResult {
  outcome: ConvertOutcome;
  reason?: ConversionPreviewReason | "unsupported_product" | "conflict";
  buyer?: Buyer;
  conversion?: CandidateConversion;
  duplicateMatch?: ConversionDuplicateMatch;
  message?: string;
}

const workspaceLocks = new Map<string, Promise<unknown>>();

async function withWorkspaceLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = workspaceLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = previous.then(() => gate);
  workspaceLocks.set(
    key,
    held.catch(() => undefined),
  );
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

export function conversionEligibility(input: {
  candidate?: BuyerCandidate;
  conversion?: CandidateConversion;
}): ConversionEligibilityReason {
  const candidate = input.candidate;
  if (!candidate) return "not_found";
  if (input.conversion) return "already_converted";
  if (candidate.discoveryStatus === "archived") return "archived";
  if (candidate.reviewStatus === "rejected") return "rejected";
  if (candidate.reviewStatus !== "approved") return "not_approved";
  return "ok";
}

export function contactHasUsablePersonalEmail(contact: BuyerCandidateContact): boolean {
  return (
    Boolean(blankToUndefined(contact.revealedAt)) &&
    contact.emailType === "personal" &&
    Boolean(normalizeValidBuyerEmail(contact.businessEmail))
  );
}

export function isSelectableRevealedContact(contact: BuyerCandidateContact): boolean {
  return contactHasUsablePersonalEmail(contact);
}

function contactLabel(contact: BuyerCandidateContact): string {
  const full = blankToUndefined(contact.fullName);
  if (full) return full;
  const joined = [contact.firstName, contact.lastName].map((s) => s.trim()).filter(Boolean).join(" ");
  return joined || "Unnamed person";
}

function sortRevealed(a: BuyerCandidateContact, b: BuyerCandidateContact): number {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  return (b.contactScore ?? 0) - (a.contactScore ?? 0);
}

function sortPublic(a: BuyerCandidatePublicEmail, b: BuyerCandidatePublicEmail): number {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  return a.email.localeCompare(b.email);
}

export function listConversionOptions(input: {
  candidateId?: string;
  contacts: BuyerCandidateContact[];
  publicEmails: BuyerCandidatePublicEmail[];
}): ConversionOption[] {
  const options: ConversionOption[] = [];
  const contacts = input.candidateId
    ? input.contacts.filter((row) => row.candidateId === input.candidateId)
    : input.contacts;
  const publicEmails = input.candidateId
    ? input.publicEmails.filter((row) => row.candidateId === input.candidateId)
    : input.publicEmails;
  const revealed = contacts.filter(isSelectableRevealedContact).slice().sort(sortRevealed);
  const masked = contacts.filter((c) => !isSelectableRevealedContact(c));
  for (const c of revealed) {
    options.push({
      kind: "revealed_personal_contact",
      contactId: c.id,
      label: contactLabel(c),
      title: blankToUndefined(c.jobTitle),
      email: normalizeValidBuyerEmail(c.businessEmail)!,
      selectable: true,
    });
  }
  const publics = publicEmails.slice().sort(sortPublic);
  for (const e of publics) {
    const email = normalizeValidBuyerEmail(e.email);
    if (!email || e.source !== "company_website") continue;
    options.push({
      kind: "public_company_email",
      publicEmailId: e.id,
      email,
      selectable: true,
    });
  }
  for (const c of masked) {
    const reason = !blankToUndefined(c.revealedAt)
      ? "Personal email not revealed"
      : c.emailType !== "personal"
        ? "Only revealed personal email can be used"
        : "A valid personal email is required";
    options.push({
      kind: "masked_person",
      contactId: c.id,
      label: contactLabel(c),
      title: blankToUndefined(c.jobTitle),
      selectable: false,
      reason,
    });
  }
  // BF5B-final: company_only is no longer offered. Email is mandatory to
  // create a Buyer. A Candidate with no revealed personal contact and no
  // public company email stays in Buyer Finder as a research record and
  // shows the "Needs contact" state — it does not enter public.buyers.
  return options;
}

/**
 * BF5B-final — true when at least one selectable email-bearing option
 * exists for this Candidate. Drives the "Needs contact" UX: with no
 * usable email, the CandidateConversionPanel presents a research-only
 * state instead of a Convert button.
 */
export function hasUsableEmailForConversion(input: {
  candidateId?: string;
  contacts: BuyerCandidateContact[];
  publicEmails: BuyerCandidatePublicEmail[];
}): boolean {
  return listConversionOptions(input).some(
    (o) => o.kind === "revealed_personal_contact" || o.kind === "public_company_email",
  );
}

export function defaultConversionSelection(options: ConversionOption[]): ConversionSelectionInput {
  const revealed = options.find(
    (o): o is ConversionContactOption => o.kind === "revealed_personal_contact",
  );
  if (revealed) return { kind: "revealed_personal_contact", contactId: revealed.contactId };
  const pub = options.find(
    (o): o is ConversionPublicEmailOption => o.kind === "public_company_email",
  );
  if (pub) return { kind: "public_company_email", publicEmailId: pub.publicEmailId };
  // No selectable email-bearing option — an empty selection signals that
  // the caller cannot convert. Preview will surface "Needs contact".
  return {};
}

export function resolveConversionSelection(input: {
  requested?: ConversionSelectionInput;
  candidateId?: string;
  contacts: BuyerCandidateContact[];
  publicEmails: BuyerCandidatePublicEmail[];
}): { ok: true; selection: Required<Pick<ConversionSelectionInput, "kind">> & ConversionSelectionInput } | { ok: false } {
  const options = listConversionOptions({
    candidateId: input.candidateId,
    contacts: input.contacts,
    publicEmails: input.publicEmails,
  });
  const requested = input.requested?.kind
    ? input.requested
    : defaultConversionSelection(options);
  // BF5B-final: company_only is no longer a valid caller-supplied
  // selection. A stale request for company_only resolves as unresolvable
  // — createBlocked=true, "Needs contact" surfaced by the panel.
  if (requested.kind === "company_only") {
    return { ok: false };
  }
  if (requested.kind === "revealed_personal_contact" || requested.contactId) {
    const contact = input.contacts.find(
      (c) =>
        c.id === requested.contactId &&
        (!input.candidateId || c.candidateId === input.candidateId),
    );
    if (!contact || !isSelectableRevealedContact(contact)) return { ok: false };
    return {
      ok: true,
      selection: { kind: "revealed_personal_contact", contactId: contact.id },
    };
  }
  if (requested.kind === "public_company_email" || requested.publicEmailId) {
    const row = input.publicEmails.find(
      (e) =>
        e.id === requested.publicEmailId &&
        (!input.candidateId || e.candidateId === input.candidateId),
    );
    if (
      !row ||
      row.source !== "company_website" ||
      !normalizeValidBuyerEmail(row.email)
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      selection: { kind: "public_company_email", publicEmailId: row.id },
    };
  }
  return { ok: false };
}

/**
 * Structured first/last when present. Does not parse fullName — there is
 * no trusted project name-splitter. Ahmed El Din must come from persisted
 * firstName/lastName (Hunter reveal writes those fields).
 */
export function mapPersonName(contact: BuyerCandidateContact): { firstName: string; lastName: string } {
  return {
    firstName: (contact.firstName ?? "").trim(),
    lastName: (contact.lastName ?? "").trim(),
  };
}

export function mapProductInterest(matches: BuyerCandidateProductMatch[]): string | undefined {
  if (!matches.length) return undefined;
  const ranked = [...matches].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  for (const m of ranked) {
    const label = findBusinessProductById(m.productId)?.displayName;
    if (label) return label;
  }
  return undefined;
}

/**
 * BF5A.1 — pick the row id of the top-relevance product match whose
 * productId maps to a known business product. The convert RPC then
 * derives the canonical display label from the persisted product_key
 * itself, so the browser cannot smuggle in a label. Preview UI still
 * uses `mapProductInterest` for display; the RPC path uses this.
 */
export function pickAuthoritativeProductMatchId(
  matches: BuyerCandidateProductMatch[],
): string | undefined {
  if (!matches.length) return undefined;
  const ranked = [...matches].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  for (const m of ranked) {
    if (findBusinessProductById(m.productId)) return m.id;
  }
  return undefined;
}

export function mapConversionBuyer(input: {
  candidate: BuyerCandidate;
  contacts: BuyerCandidateContact[];
  publicEmails: BuyerCandidatePublicEmail[];
  productMatches: BuyerCandidateProductMatch[];
  selection: ConversionSelectionInput;
}): ConversionMapping | undefined {
  const resolved = resolveConversionSelection({
    requested: input.selection,
    candidateId: input.candidate.id,
    contacts: input.contacts,
    publicEmails: input.publicEmails,
  });
  if (!resolved.ok) return undefined;
  const { selection } = resolved;
  const company = input.candidate.companyName.trim();
  const country = input.candidate.country.trim();
  const website = blankToUndefined(input.candidate.website);
  const productInterest = mapProductInterest(input.productMatches);
  const base: ConversionMapping = {
    firstName: "",
    lastName: "",
    company,
    email: "",
    website,
    country,
    city: blankToUndefined(input.candidate.city),
    productInterest,
    source: BUYER_FINDER_BUYER_SOURCE,
  };

  if (selection.kind === "revealed_personal_contact") {
    const contact = input.contacts.find((c) => c.id === selection.contactId)!;
    const names = mapPersonName(contact);
    return {
      ...base,
      ...names,
      email: normalizeValidBuyerEmail(contact.businessEmail) ?? "",
      phone: blankToUndefined(contact.phoneNumber),
    };
  }
  if (selection.kind === "public_company_email") {
    const row = input.publicEmails.find((e) => e.id === selection.publicEmailId)!;
    return {
      ...base,
      email: normalizeValidBuyerEmail(row.email) ?? "",
    };
  }
  return base;
}

function buyerHost(buyer: Buyer): string | undefined {
  const fromSite = normalizeDomain(buyer.website);
  if (fromSite && !isPublicEmailDomain(fromSite)) return fromSite;
  return undefined;
}

function candidateHost(candidate: BuyerCandidate): string | undefined {
  const fromDomain = normalizeDomain(candidate.domain);
  const fromSite = normalizeDomain(candidate.website);
  const host = fromDomain ?? fromSite;
  if (host && !isPublicEmailDomain(host)) return host;
  return undefined;
}

export function findConversionDuplicate(input: {
  mapping: ConversionMapping;
  candidate: BuyerCandidate;
  existingBuyers: Buyer[];
}): ConversionDuplicateMatch | undefined {
  const email = normalizeOptionalEmail(input.mapping.email);
  const domain = candidateHost(input.candidate);
  const company = normalizeCompanyNameForCompare(input.mapping.company);

  for (const buyer of input.existingBuyers) {
    const buyerEmail = normalizeOptionalEmail(buyer.email);
    if (email && buyerEmail && email === buyerEmail) {
      return {
        class: "definite",
        buyerId: buyer.id,
        company: buyer.company,
        email: buyer.email,
        website: buyer.website,
        reason: "email",
      };
    }
  }
  // BF5B-final: email is now mandatory to create a Buyer, so the preview
  // never legitimately reaches this function with an empty email. If it
  // ever does (a stale caller, a mis-selection), an existing empty-email
  // Buyer still counts as a duplicate under the historical
  // `buyers_workspace_email_unique_idx` (unchanged in BF5B-final; no
  // migration touches it).
  if (!email) {
    for (const buyer of input.existingBuyers) {
      if (!normalizeOptionalEmail(buyer.email)) {
        return {
          class: "definite",
          buyerId: buyer.id,
          company: buyer.company,
          email: buyer.email,
          website: buyer.website,
          reason: "email",
        };
      }
    }
  }
  for (const buyer of input.existingBuyers) {
    const other = buyerHost(buyer);
    if (domain && other && domain === other) {
      return {
        class: "definite",
        buyerId: buyer.id,
        company: buyer.company,
        email: buyer.email,
        website: buyer.website,
        reason: "domain",
      };
    }
  }
  for (const buyer of input.existingBuyers) {
    const other = normalizeCompanyNameForCompare(buyer.company);
    if (company && other && company === other) {
      return {
        class: "possible",
        buyerId: buyer.id,
        company: buyer.company,
        email: buyer.email,
        website: buyer.website,
        reason: "company_name",
      };
    }
  }
  return undefined;
}

export function websiteLabel(candidate: BuyerCandidate): string | undefined {
  return blankToUndefined(candidate.website) ?? blankToUndefined(candidate.domain);
}

export function buildConversionPreview(input: {
  candidate?: BuyerCandidate;
  contacts: BuyerCandidateContact[];
  publicEmails: BuyerCandidatePublicEmail[];
  productMatches: BuyerCandidateProductMatch[];
  existingBuyers: Buyer[];
  conversion?: CandidateConversion;
  requested?: ConversionSelectionInput;
}): ConversionPreview {
  const eligibility = conversionEligibility({
    candidate: input.candidate,
    conversion: input.conversion,
  });
  const options = listConversionOptions({
    candidateId: input.candidate?.id,
    contacts: input.contacts,
    publicEmails: input.publicEmails,
  });
  const resolved = resolveConversionSelection({
    requested: input.requested,
    candidateId: input.candidate?.id,
    contacts: input.contacts,
    publicEmails: input.publicEmails,
  });
  const selection = resolved.ok
    ? resolved.selection
    : defaultConversionSelection(options);
  const emptyMapping: ConversionMapping = {
    firstName: "",
    lastName: "",
    company: input.candidate?.companyName ?? "",
    email: "",
    country: input.candidate?.country ?? "",
    source: BUYER_FINDER_BUYER_SOURCE,
  };
  const mapping =
    input.candidate && resolved.ok
      ? mapConversionBuyer({
          candidate: input.candidate,
          contacts: input.contacts,
          publicEmails: input.publicEmails,
          productMatches: input.productMatches,
          selection,
        }) ?? emptyMapping
      : emptyMapping;
  const duplicateMatch =
    eligibility === "ok" && input.candidate
      ? findConversionDuplicate({
          mapping,
          candidate: input.candidate,
          existingBuyers: input.existingBuyers,
        })
      : undefined;
  const missingEmail = mapping.email.length === 0;
  const reason = conversionPreviewReason({
    eligibility,
    candidate: input.candidate,
    contacts: input.contacts,
    publicEmails: input.publicEmails,
    requested: input.requested,
    resolved: resolved.ok,
    duplicate: Boolean(duplicateMatch),
  });
  const canConvert = reason === "ready";
  const createBlocked = !canConvert;
  return {
    canConvert,
    reason,
    eligibility,
    candidateId: input.candidate?.id ?? "",
    companyName: input.candidate?.companyName ?? "",
    country: input.candidate?.country ?? "",
    websiteLabel: input.candidate ? websiteLabel(input.candidate) : undefined,
    mapping,
    sourceKind: selection.kind ?? "revealed_personal_contact",
    options,
    selected: selection,
    duplicate: duplicateMatch?.class ?? "none",
    duplicateMatch,
    missingEmail,
    createBlocked,
  };
}

function conversionPreviewReason(input: {
  eligibility: ConversionEligibilityReason;
  candidate?: BuyerCandidate;
  contacts: BuyerCandidateContact[];
  publicEmails: BuyerCandidatePublicEmail[];
  requested?: ConversionSelectionInput;
  resolved: boolean;
  duplicate: boolean;
}): ConversionPreviewReason {
  if (input.requested?.kind === "company_only") {
    return "invalid_selection";
  }
  switch (input.eligibility) {
    case "not_found":
      return "not_found";
    case "not_approved":
      return "not_approved";
    case "rejected":
    case "archived":
      return "invalid_candidate_state";
    case "already_converted":
      return "already_converted";
    case "invalid_selection":
      return "invalid_selection";
  }

  if (!input.resolved) {
    const candidateId = input.candidate?.id;
    const requested = input.requested;
    if (
      (requested?.kind === "revealed_personal_contact" &&
        (!requested.contactId || Boolean(requested.publicEmailId))) ||
      (requested?.kind === "public_company_email" &&
        (!requested.publicEmailId || Boolean(requested.contactId)))
    ) {
      return "invalid_selection";
    }
    if (requested?.contactId) {
      const contact = input.contacts.find(
        (row) => row.id === requested.contactId && row.candidateId === candidateId,
      );
      return contact ? "unsupported_email_source" : "invalid_selection";
    }
    if (requested?.publicEmailId) {
      const email = input.publicEmails.find(
        (row) => row.id === requested.publicEmailId && row.candidateId === candidateId,
      );
      return email ? "unsupported_email_source" : "invalid_selection";
    }
    const hasUnsupportedSource =
      Boolean(blankToUndefined(input.candidate?.generalEmail)) ||
      input.contacts.some((row) => row.candidateId === candidateId) ||
      input.publicEmails.some((row) => row.candidateId === candidateId);
    return hasUnsupportedSource ? "unsupported_email_source" : "missing_email";
  }

  if (input.duplicate) return "duplicate_buyer";
  return "ready";
}

export function conversionPreviewReasonMessage(reason: ConversionPreviewReason): string {
  switch (reason) {
    case "ready":
      return "Ready to create a Buyer.";
    case "not_found":
      return "This Candidate is unavailable in the selected workspace.";
    case "not_approved":
      return "Approve this Candidate for Buyer review before converting it.";
    case "missing_email":
      return "A verified conversion-eligible email is required.";
    case "unsupported_email_source":
      return "The available email source cannot be used for Buyer conversion.";
    case "invalid_candidate_state":
      return "This Candidate is rejected or archived and cannot be converted.";
    case "already_converted":
      return "This Candidate has already been converted.";
    case "duplicate_buyer":
      return "A matching Buyer already exists.";
    case "invalid_selection":
      return "Choose a valid conversion-eligible email source.";
  }
}

export function mappingToBuyer(mapping: ConversionMapping, nowIso: string): Buyer {
  return {
    id: newEntityId(),
    firstName: mapping.firstName,
    lastName: mapping.lastName,
    company: mapping.company,
    email: mapping.email,
    phone: mapping.phone,
    website: mapping.website,
    country: mapping.country,
    city: mapping.city,
    productInterest: mapping.productInterest,
    source: mapping.source,
    status: "new",
    suppressed: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * In-process conversion used by tests and as the memory-repo implementation.
 * Production uses the Postgres RPC which repeats eligibility + duplicate
 * checks under a workspace advisory lock.
 */
export async function convertCandidateToBuyer(input: {
  workspaceKey: string;
  candidate?: BuyerCandidate;
  contacts: BuyerCandidateContact[];
  publicEmails: BuyerCandidatePublicEmail[];
  productMatches: BuyerCandidateProductMatch[];
  loadExistingBuyers: () => Promise<Buyer[]>;
  loadConversion: () => Promise<CandidateConversion | undefined>;
  requested?: ConversionSelectionInput;
  now?: () => Date;
  insertAtomic: (buyer: Buyer, conversion: CandidateConversion) => Promise<void>;
}): Promise<ConvertResult> {
  return withWorkspaceLock(input.workspaceKey, async () => {
    const conversion = await input.loadConversion();
    const candidate = input.candidate;
    const eligibility = conversionEligibility({ candidate, conversion });
    if (eligibility === "already_converted" && conversion) {
      return {
        outcome: "already_converted",
        reason: "already_converted",
        conversion,
        message: conversionPreviewReasonMessage("already_converted"),
      };
    }
    if (eligibility === "not_found") {
      return {
        outcome: "not_found",
        reason: "not_found",
        message: conversionPreviewReasonMessage("not_found"),
      };
    }
    if (eligibility !== "ok" || !candidate) {
      const reason =
        eligibility === "not_approved" ? "not_approved" : "invalid_candidate_state";
      return {
        outcome: "not_eligible",
        reason,
        message: conversionPreviewReasonMessage(reason),
      };
    }
    const resolved = resolveConversionSelection({
      requested: input.requested,
      candidateId: candidate.id,
      contacts: input.contacts,
      publicEmails: input.publicEmails,
    });
    if (!resolved.ok) {
      const reason = conversionPreviewReason({
        eligibility,
        candidate,
        contacts: input.contacts,
        publicEmails: input.publicEmails,
        requested: input.requested,
        resolved: false,
        duplicate: false,
      });
      return {
        outcome: "invalid_selection",
        reason,
        message: conversionPreviewReasonMessage(reason),
      };
    }
    const mapping = mapConversionBuyer({
      candidate,
      contacts: input.contacts,
      publicEmails: input.publicEmails,
      productMatches: input.productMatches,
      selection: resolved.selection,
    });
    if (!mapping) {
      return {
        outcome: "invalid_selection",
        reason: "invalid_selection",
        message: conversionPreviewReasonMessage("invalid_selection"),
      };
    }
    const existingBuyers = await input.loadExistingBuyers();
    const duplicateMatch = findConversionDuplicate({
      mapping,
      candidate,
      existingBuyers,
    });
    if (duplicateMatch) {
      return {
        outcome: "duplicate",
        reason: "duplicate_buyer",
        duplicateMatch,
        message: conversionPreviewReasonMessage("duplicate_buyer"),
      };
    }
    const nowIso = (input.now ?? (() => new Date()))().toISOString();
    const buyer = mappingToBuyer(mapping, nowIso);
    const row: CandidateConversion = {
      id: newEntityId(),
      candidateId: candidate.id,
      buyerId: buyer.id,
      sourceKind: resolved.selection.kind!,
      contactId: resolved.selection.contactId,
      publicEmailId: resolved.selection.publicEmailId,
      createdAt: nowIso,
    };
    await input.insertAtomic(buyer, row);
    return { outcome: "created", buyer, conversion: row };
  });
}

/**
 * BF5B: prefer an exact `?buyerId=<uuid>` link when the caller knows the
 * Buyer's id (the conversion linkage always does). The Buyers page reads
 * `buyerId`, opens the drawer on that exact row, and rejects an unknown
 * or cross-workspace id safely. When we only have display fields (a
 * duplicate hint with no id), fall back to a search-style `?q=` link.
 */
export function buyerOpenHref(
  buyer: { id?: string | null } & Pick<Buyer, "email" | "company">,
): string {
  const id = (buyer.id ?? "").trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return `/buyers?buyerId=${id}`;
  }
  const q = normalizeOptionalEmail(buyer.email) || (buyer.company ?? "").trim();
  return `/buyers?q=${encodeURIComponent(q)}`;
}

/**
 * Browser may send only identity flags — never raw Buyer field values.
 * BF5B-final: `companyOnly` is no longer a valid identity. Email is
 * mandatory to create a Buyer; a Candidate with no revealed personal
 * contact and no public company email stays a research record.
 */
export function selectionFromBrowserInput(input: {
  contactId?: string;
  publicEmailId?: string;
}): ConversionSelectionInput | undefined {
  const n =
    Number(Boolean(input.contactId?.trim())) +
    Number(Boolean(input.publicEmailId?.trim()));
  if (n > 1) return undefined;
  if (input.contactId?.trim()) {
    return { kind: "revealed_personal_contact", contactId: input.contactId.trim() };
  }
  if (input.publicEmailId?.trim()) {
    return { kind: "public_company_email", publicEmailId: input.publicEmailId.trim() };
  }
  return undefined;
}
