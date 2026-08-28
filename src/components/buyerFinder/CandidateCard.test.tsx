import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CandidateCard } from "./CandidateCard";

afterEach(() => cleanup());

const HUNTER_EVIDENCE = [
  {
    note: "Hunter Discover company match. Directory match only — not proof of import or distribution.",
    confidence: 40,
  },
];

describe("CandidateCard", () => {
  it("labels the persisted score as Overall and does not show 50% relevance for Hunter matches", () => {
    render(
      <CandidateCard
        record={{
          candidate: {
            id: "00000000-0000-4000-8000-0000000000aa",
            companyName: "Mahmood & Sons",
            country: "United Arab Emirates",
            source: "hunter",
            companyScore: 23,
            discoveryStatus: "ready",
            reviewStatus: "pending",
          },
          productMatches: [
            {
              id: "00000000-0000-4000-8000-0000000000bb",
              candidateId: "00000000-0000-4000-8000-0000000000aa",
              productId: "guntur-dry-red-chilli",
              relevance: 50,
              evidence: HUNTER_EVIDENCE,
              source: "hunter",
            },
          ],
          contactCount: 0,
        }}
      />,
    );
    expect(screen.getByText(/Overall 23/)).toBeTruthy();
    expect(screen.getByText("Directory keyword match")).toBeTruthy();
    expect(screen.queryByText(/50% relevance/)).toBeNull();
    expect(screen.getByText("Contact enrichment not run yet")).toBeTruthy();
  });
});
