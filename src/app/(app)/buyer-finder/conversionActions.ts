"use server";

import { revalidatePath } from "next/cache";
import { requireMdfSession } from "@/lib/auth/require";
import { serverRepositories } from "@/lib/repositories/server";
import { isEntityUuid } from "@/lib/buyerFinder/ids";
import {
  buildConversionPreview,
  buyerOpenHref,
  pickAuthoritativeProductMatchId,
  resolveConversionSelection,
  selectionFromBrowserInput,
  type ConversionPreview,
  type ConversionSelectionInput,
  type ConvertResult,
} from "@/lib/buyerFinder/conversion";

export type ConversionBrowserInput = {
  candidateId: string;
  contactId?: string;
  publicEmailId?: string;
};

export type ConversionPreviewResult = ConversionPreview & {
  buyerHref?: string;
  convertedBuyerId?: string;
};

export type ConvertCandidateResult = ConvertResult & {
  buyerHref?: string;
};

function emptyPreview(candidateId: string, eligibility: ConversionPreview["eligibility"]): ConversionPreviewResult {
  return buildConversionPreview({
    candidate: eligibility === "not_found" ? undefined : {
      id: candidateId,
      companyName: "",
      country: "",
      discoveryStatus: "ready",
      reviewStatus: "pending",
    },
    contacts: [],
    publicEmails: [],
    productMatches: [],
    existingBuyers: [],
  });
}

function parseSelection(input: ConversionBrowserInput): ConversionSelectionInput | undefined | "invalid" {
  if (input.contactId && !isEntityUuid(input.contactId)) return "invalid";
  if (input.publicEmailId && !isEntityUuid(input.publicEmailId)) return "invalid";
  const parsed = selectionFromBrowserInput({
    contactId: input.contactId,
    publicEmailId: input.publicEmailId,
  });
  if ((input.contactId || input.publicEmailId) && parsed === undefined) {
    return "invalid";
  }
  return parsed;
}

/**
 * Server-derived conversion preview. Does not insert a Buyer.
 * Browser may send candidateId plus a contact/public-email identity.
 * BF5B-final: no company-only option — email is mandatory to create a
 * Buyer. Company, email, country, website, and product are ignored on
 * the wire; the RPC re-loads them from persisted candidate data.
 */
export async function previewCandidateConversionAction(
  input: ConversionBrowserInput,
): Promise<ConversionPreviewResult> {
  await requireMdfSession();
  const candidateId = (input.candidateId ?? "").trim();
  if (!isEntityUuid(candidateId)) {
    return emptyPreview(candidateId, "not_found");
  }
  const requested = parseSelection(input);
  if (requested === "invalid") {
    const preview = emptyPreview(candidateId, "not_found");
    return { ...preview, eligibility: "invalid_selection", createBlocked: true };
  }

  const { repos } = await serverRepositories();
  const [candidate, contacts, publicEmails, productMatches, conversion, existingBuyers] =
    await Promise.all([
      repos.buyerCandidates.get(candidateId),
      repos.buyerCandidateContacts.listByCandidate(candidateId),
      repos.buyerCandidatePublicEmails.listByCandidate(candidateId),
      repos.buyerCandidateProductMatches.listByCandidate(candidateId),
      repos.buyerFinderCandidateConversions.getByCandidate(candidateId),
      repos.buyers.list(),
    ]);

  const preview = buildConversionPreview({
    candidate,
    contacts,
    publicEmails,
    productMatches,
    existingBuyers,
    conversion,
    requested,
  });

  let buyerHref: string | undefined;
  if (conversion) {
    const buyer = await repos.buyers.get(conversion.buyerId);
    if (buyer) buyerHref = buyerOpenHref(buyer);
  } else if (preview.duplicateMatch) {
    const buyer = existingBuyers.find((b) => b.id === preview.duplicateMatch?.buyerId);
    if (buyer) buyerHref = buyerOpenHref(buyer);
  }

  return {
    ...preview,
    buyerHref,
    convertedBuyerId: conversion?.buyerId,
  };
}

/**
 * Final Create Buyer. Reloads authoritative Candidate data, re-checks
 * eligibility and duplicates, then runs the atomic conversion RPC.
 * Does not send mail, reveal contacts, or mutate campaigns.
 */
export async function convertCandidateToBuyerAction(
  input: ConversionBrowserInput,
): Promise<ConvertCandidateResult> {
  await requireMdfSession();
  const candidateId = (input.candidateId ?? "").trim();
  if (!isEntityUuid(candidateId)) {
    return { outcome: "invalid_selection", message: "Invalid candidate id." };
  }
  const requested = parseSelection(input);
  if (requested === "invalid") {
    return { outcome: "invalid_selection", message: "Choose a valid contact source." };
  }

  const { repos } = await serverRepositories();
  const [candidate, contacts, publicEmails, productMatches, conversion] = await Promise.all([
    repos.buyerCandidates.get(candidateId),
    repos.buyerCandidateContacts.listByCandidate(candidateId),
    repos.buyerCandidatePublicEmails.listByCandidate(candidateId),
    repos.buyerCandidateProductMatches.listByCandidate(candidateId),
    repos.buyerFinderCandidateConversions.getByCandidate(candidateId),
  ]);

  if (conversion) {
    const buyer = await repos.buyers.get(conversion.buyerId);
    return {
      outcome: "already_converted",
      conversion,
      buyer,
      buyerHref: buyer ? buyerOpenHref(buyer) : undefined,
      message: "This candidate is already a Buyer.",
    };
  }

  const resolved = resolveConversionSelection({
    requested,
    contacts,
    publicEmails,
  });
  if (!resolved.ok || !candidate) {
    return {
      outcome: candidate ? "invalid_selection" : "not_found",
      message: candidate ? "Choose a valid contact source." : "Candidate not found.",
    };
  }

  // BF5A.1 — pass an authoritative product-match id, not a text label.
  // The RPC re-loads the row for (id, candidate_id, workspace_id) and
  // derives buyers.product_interest from the persisted product_key.
  const productMatchId = pickAuthoritativeProductMatchId(productMatches);
  const result = await repos.buyerFinderCandidateConversions.convert({
    candidateId,
    sourceKind: resolved.selection.kind!,
    contactId: resolved.selection.contactId,
    publicEmailId: resolved.selection.publicEmailId,
    productMatchId,
  });

  if (result.outcome === "created" || result.outcome === "already_converted") {
    revalidatePath("/buyer-finder");
    revalidatePath(`/buyer-finder/candidate/${candidateId}`);
    revalidatePath("/buyers");
  }

  const buyerHref = result.buyer
    ? buyerOpenHref(result.buyer)
    : result.duplicateMatch
      ? buyerOpenHref({
          id: result.duplicateMatch.buyerId,
          email: result.duplicateMatch.email,
          company: result.duplicateMatch.company,
        })
      : undefined;

  return { ...result, buyerHref };
}
