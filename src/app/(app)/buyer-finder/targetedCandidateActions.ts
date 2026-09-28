"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireMdfSession } from "@/lib/auth/require";
import { findCountryByCode, codeForCountryName, findCountryByName } from "@/lib/catalogue/countries";
import { PRODUCTS } from "@/lib/catalogue/products";
import { normalizeDomain } from "@/lib/buyerFinder/normalize";
import { serverRepositories } from "@/lib/repositories/server";
import type { BuyerCandidate } from "@/lib/buyerFinder/types";

/**
 * BI4F Phase 2C — Targeted company discovery.
 *
 * A legitimate permanent Buyer Finder capability: when MDF already
 * knows a company by name and/or domain (from trade fairs,
 * referrals, buyer lists, industry directories, inbound enquiries,
 * or manual research), the operator seeds the candidate directly.
 * The result flows through the normal Buyer Finder pipeline — same
 * table, same product-match mechanism, same review/approval
 * semantics.
 *
 * INVARIANTS (permanent):
 *   • Candidate ≠ Buyer. This action NEVER creates a Buyer row.
 *   • No email/reveal. Personal reveal credits are never consumed.
 *   • Automatic monetary spend = ₹0.
 *   • Product target is CONTEXT, never promoted to verified import
 *     evidence. Product-match rows carry search intent, not proof.
 *   • Owner-only.
 *   • Duplicate-safe: existing candidates are reused (by domain,
 *     then by normalized name).
 *   • Provenance: newly-created targeted candidates persist with
 *     `source: "other"` (the non-mock, non-provider marker used
 *     when a real user manually seeded the record). Existing rows'
 *     `source` is never overwritten.
 *   • Never fabricates fields the operator didn't supply.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LEN = 200;
const MAX_DOMAIN_LEN = 253;

export type TargetedCandidateInput = {
  companyName?: string;
  domain?: string;
  countryCode?: string;
  countryName?: string;
  productId: string;
  /** Operator targeting context only; never persisted as a company fact. */
  buyerType?: string;
};

export type TargetedCandidateResult =
  | { outcome: "created" | "reused"; candidateId: string; candidateName: string; productMatchCreated: boolean }
  | { outcome: "forbidden" | "invalid_input"; message: string };

function normalizeCompanyName(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").trim();
}

function isCatalogueProductId(id: string): boolean {
  return PRODUCTS.some((p) => p.id === id);
}

export async function createTargetedCandidateAction(input: TargetedCandidateInput): Promise<TargetedCandidateResult> {
  const session = await requireMdfSession();
  if (session.membership.role !== "owner") {
    return { outcome: "forbidden", message: "Only a workspace owner can add a targeted company." };
  }

  const rawName = typeof input.companyName === "string" ? input.companyName.trim() : "";
  const rawDomain = typeof input.domain === "string" ? input.domain.trim() : "";
  const rawCountryCode = typeof input.countryCode === "string" ? input.countryCode.trim() : "";
  const rawCountryName = typeof input.countryName === "string" ? input.countryName.trim() : "";
  const productId = typeof input.productId === "string" ? input.productId.trim() : "";

  if (!rawName && !rawDomain) {
    return { outcome: "invalid_input", message: "Provide at least a company name or a company domain." };
  }
  if (rawName.length > MAX_NAME_LEN) {
    return { outcome: "invalid_input", message: "Company name is too long." };
  }
  if (rawDomain.length > MAX_DOMAIN_LEN) {
    return { outcome: "invalid_input", message: "Company domain is too long." };
  }
  const normalizedDomain = normalizeDomain(rawDomain);
  if (rawDomain && !normalizedDomain) {
    return { outcome: "invalid_input", message: "Company domain is not a recognisable host." };
  }
  if (!productId || !isCatalogueProductId(productId)) {
    return { outcome: "invalid_input", message: "Product is not in the MDF canonical catalogue." };
  }

  // Country canonicalization: accept ISO code, ISO name, or display name.
  let countryDisplay: string | undefined;
  if (rawCountryCode) {
    const found = findCountryByCode(rawCountryCode);
    if (!found) return { outcome: "invalid_input", message: "Country code is not a canonical ISO-3166-1 alpha-2 code." };
    countryDisplay = found.name;
  } else if (rawCountryName) {
    const iso = codeForCountryName(rawCountryName);
    if (!iso) return { outcome: "invalid_input", message: "Country name is not in the canonical catalogue." };
    countryDisplay = findCountryByCode(iso)?.name;
  } else {
    return { outcome: "invalid_input", message: "Country is required." };
  }
  if (!countryDisplay) {
    return { outcome: "invalid_input", message: "Country could not be resolved." };
  }

  const { repos } = await serverRepositories();

  // Duplicate safety: domain first (strongest identity), then normalized name.
  let existing: BuyerCandidate | undefined;
  if (normalizedDomain) {
    existing = await repos.buyerCandidates.findByDomain(normalizedDomain);
  }
  if (!existing && rawName) {
    const targetName = normalizeCompanyName(rawName);
    if (targetName) {
      const all = await repos.buyerCandidates.list();
      existing = all.find((c) => normalizeCompanyName(c.companyName) === targetName);
    }
  }

  let candidate: BuyerCandidate;
  if (existing) {
    candidate = existing;
  } else {
    // Create fresh candidate. `source: "other"` marks this as
    // operator-seeded rather than provider-discovered.
    const displayName = rawName || (normalizedDomain ?? "").split(".")[0]?.toUpperCase() || "Unnamed company";
    const created: BuyerCandidate = {
      id: randomUUID(),
      companyName: displayName,
      domain: normalizedDomain,
      website: rawDomain && normalizedDomain ? (rawDomain.startsWith("http") ? rawDomain : `https://${normalizedDomain}`) : undefined,
      country: countryDisplay,
      // buyerType is search/operator intent and is not an observed fact.
      buyerType: undefined,
      source: "other",
      sourceUrl: undefined,
      isImporter: undefined,
      isDistributor: undefined,
      discoveryStatus: "ready",
      reviewStatus: "pending",
    };
    candidate = await repos.buyerCandidates.create(created);
  }

  // Ensure a canonical product-match row exists. Product context is
  // SEARCH INTENT, never a verified-import claim — this is the
  // exact-same distinction the existing product-match repository
  // preserves for broad Buyer Finder discovery.
  let productMatchCreated = false;
  const existingMatch = await repos.buyerCandidateProductMatches.findByCandidateAndProduct(candidate.id, productId);
  if (!existingMatch) {
    await repos.buyerCandidateProductMatches.create({
      id: randomUUID(),
      candidateId: candidate.id,
      productId,
      relevance: undefined,
      evidence: undefined,
      source: "other",
      sourceUrl: undefined,
    } as unknown as Parameters<typeof repos.buyerCandidateProductMatches.create>[0]);
    productMatchCreated = true;
  }

  revalidatePath("/buyer-finder");
  return {
    outcome: existing ? "reused" : "created",
    candidateId: candidate.id,
    candidateName: candidate.companyName,
    productMatchCreated,
  };
}

/**
 * Server-side validation of a raw targeted-candidate request WITHOUT
 * requiring an owner session — used by tests that exercise input
 * validation independently. Returns the same shape as the action.
 */
export function validateTargetedCandidateInputForTests(input: TargetedCandidateInput): TargetedCandidateResult | null {
  const rawName = typeof input.companyName === "string" ? input.companyName.trim() : "";
  const rawDomain = typeof input.domain === "string" ? input.domain.trim() : "";
  const productId = typeof input.productId === "string" ? input.productId.trim() : "";
  if (!rawName && !rawDomain) return { outcome: "invalid_input", message: "Provide at least a company name or a company domain." };
  if (rawDomain && !normalizeDomain(rawDomain)) return { outcome: "invalid_input", message: "Company domain is not a recognisable host." };
  if (!productId || !isCatalogueProductId(productId)) return { outcome: "invalid_input", message: "Product is not in the MDF canonical catalogue." };
  const isoByCode = input.countryCode ? findCountryByCode(input.countryCode) : undefined;
  const isoByName = !isoByCode && input.countryName ? findCountryByName(input.countryName) : undefined;
  if (!isoByCode && !isoByName && !(input.countryName && codeForCountryName(input.countryName))) {
    return { outcome: "invalid_input", message: "Country is required." };
  }
  return null;
}
