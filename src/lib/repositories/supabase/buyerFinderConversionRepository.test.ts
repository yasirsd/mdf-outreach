import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseBuyerFinderCandidateConversionRepository } from "./buyerFinderConversionRepository";

const CANDIDATE_ID = "00000000-0000-4000-8000-0000000000aa";

function repositoryWithPayload(payload: Record<string, unknown>) {
  const rpc = vi.fn(async () => ({ data: payload, error: null }));
  const client = { rpc } as unknown as SupabaseClient;
  return {
    rpc,
    repository: new SupabaseBuyerFinderCandidateConversionRepository(client, "workspace-a"),
  };
}

describe("T04 conversion RPC result mapping", () => {
  it("maps the authoritative not-approved rejection to safe UI copy", async () => {
    const { repository } = repositoryWithPayload({
      outcome: "not_eligible",
      reason: "not_approved",
    });
    const result = await repository.convert({
      candidateId: CANDIDATE_ID,
      sourceKind: "public_company_email",
      publicEmailId: "00000000-0000-4000-8000-0000000000e1",
    });
    expect(result).toMatchObject({
      outcome: "not_eligible",
      reason: "not_approved",
      message: "Approve this Candidate for Buyer review before converting it.",
    });
  });

  it("does not expose workspace authorization internals", async () => {
    const { repository } = repositoryWithPayload({ outcome: "unauthorized" });
    const result = await repository.convert({
      candidateId: CANDIDATE_ID,
      sourceKind: "public_company_email",
      publicEmailId: "00000000-0000-4000-8000-0000000000e1",
    });
    expect(result).toMatchObject({
      outcome: "not_found",
      reason: "not_found",
      message: "This Candidate is unavailable in the selected workspace.",
    });
    expect(result.message).not.toMatch(/sql|postgres|rls|uuid|service.role/i);
  });

  it("preserves the authoritative unsupported-product reason without raw database text", async () => {
    const { repository } = repositoryWithPayload({
      outcome: "invalid_selection",
      reason: "unsupported_product",
    });
    const result = await repository.convert({
      candidateId: CANDIDATE_ID,
      sourceKind: "revealed_personal_contact",
      contactId: "00000000-0000-4000-8000-0000000000c1",
    });
    expect(result).toMatchObject({
      outcome: "invalid_selection",
      reason: "unsupported_product",
      message: "The selected product cannot be used for Buyer conversion.",
    });
  });
});
