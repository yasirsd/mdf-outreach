import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { BuyerCandidateRecord } from "@/lib/buyerFinder/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/app/(app)/buyer-finder/actions", () => ({
  approveCandidateAction: vi.fn(),
  archiveCandidateAction: vi.fn(),
  rejectCandidateAction: vi.fn(),
}));

import { CandidateView } from "./CandidateView";

afterEach(() => cleanup());

const HUNTER_EVIDENCE = [
  {
    note: "Hunter Discover company match. Country United Arab Emirates (AE). Directory match only — not proof of import or distribution.",
    confidence: 40,
  },
];

function hunterRecord(over?: Partial<BuyerCandidateRecord>): BuyerCandidateRecord {
  return {
    candidate: {
      id: "00000000-0000-4000-8000-0000000000aa",
      companyName: "Mahmood & Sons",
      website: "https://mahmoodsons.com",
      domain: "mahmoodsons.com",
      country: "United Arab Emirates",
      source: "hunter",
      companyScore: 23,
      evidence: HUNTER_EVIDENCE,
      discoveryStatus: "ready",
      reviewStatus: "pending",
    },
    contacts: [],
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
    ...over,
  };
}

describe("CandidateView provenance and score copy", () => {
  it("renders Source · Hunter for a persisted hunter row", () => {
    render(<CandidateView record={hunterRecord()} />);
    expect(screen.getByText("Source · Hunter")).toBeTruthy();
    expect(screen.queryByText(/Source · mock/i)).toBeNull();
  });

  it("does not present directory placeholder as 50% relevance", () => {
    render(<CandidateView record={hunterRecord()} />);
    expect(screen.getByText("Directory keyword match")).toBeTruthy();
    expect(screen.queryByText(/50% relevance/)).toBeNull();
  });

  it("distinguishes overall score from unevaluated contact quality", () => {
    render(<CandidateView record={hunterRecord()} />);
    expect(screen.getByText(/Overall 23/)).toBeTruthy();
    expect(screen.getByText(/Company 23/)).toBeTruthy();
    expect(screen.getByText("Contact quality not evaluated")).toBeTruthy();
    expect(screen.queryByText(/Buyer 23/)).toBeNull();
  });
});
