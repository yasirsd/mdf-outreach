import { describe, expect, it } from "vitest";
import {
  isDirectoryKeywordMatch,
  productMatchStrengthLabel,
  shouldShowEvidenceConfidence,
} from "./scorePresentation";
import type { BuyerCandidateProductMatch } from "./types";

function match(over: Partial<BuyerCandidateProductMatch> = {}): BuyerCandidateProductMatch {
  return {
    id: "m1",
    candidateId: "c1",
    productId: "guntur-dry-red-chilli",
    relevance: 50,
    evidence: [],
    ...over,
  };
}

describe("productMatchStrengthLabel", () => {
  it("does not present the Hunter directory placeholder as precise 50% relevance", () => {
    const hunter = match({
      source: "hunter",
      relevance: 50,
      evidence: [
        {
          note: "Hunter Discover company match. Directory match only — not proof of import or distribution.",
          confidence: 40,
        },
      ],
    });
    expect(isDirectoryKeywordMatch(hunter)).toBe(true);
    expect(productMatchStrengthLabel(hunter)).toBe("Directory keyword match");
    expect(productMatchStrengthLabel(hunter)).not.toMatch(/50%/);
  });

  it("still recognizes Hunter evidence when source was wrongly persisted as mock", () => {
    const mislabelled = match({
      source: "mock",
      relevance: 50,
      evidence: [{ note: "Hunter Discover company match. Country United Arab Emirates (AE).", confidence: 40 }],
    });
    expect(productMatchStrengthLabel(mislabelled)).toBe("Directory keyword match");
  });

  it("keeps a numeric relevance label for mock/provider-supplied scores", () => {
    expect(
      productMatchStrengthLabel(
        match({
          source: "mock",
          relevance: 83,
          evidence: [{ note: "Listed in the mock chilli catalogue.", confidence: 80 }],
        }),
      ),
    ).toBe("83% relevance");
  });
});

describe("shouldShowEvidenceConfidence", () => {
  it("hides Hunter directory-match confidence so 40 is not shown as a buyer percentage", () => {
    expect(
      shouldShowEvidenceConfidence(
        "Hunter Discover company match. Directory match only — not proof of import or distribution.",
        40,
      ),
    ).toBe(false);
  });

  it("still shows confidence for other meaningful evidence", () => {
    expect(shouldShowEvidenceConfidence("Listed in the mock chilli catalogue.", 80)).toBe(true);
  });
});
