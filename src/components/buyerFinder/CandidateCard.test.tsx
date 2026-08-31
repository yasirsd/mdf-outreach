import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/app/(app)/buyer-finder/publicContactActions", () => ({
  findCandidatePublicCompanyContactsAction: vi.fn(),
}));

vi.mock("@/app/(app)/buyer-finder/personActions", () => ({
  findCandidateDecisionMakersAction: vi.fn(),
}));

vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { CandidateCard } from "./CandidateCard";

afterEach(() => cleanup());

const HUNTER_EVIDENCE = [
  {
    note: "Hunter Discover company match. Directory match only — not proof of import or distribution.",
    confidence: 40,
  },
];

describe("CompanyIntelligenceCard", () => {
  it("does not show LinkedIn without a person, and keeps directory evidence", () => {
    render(
      <CandidateCard
        record={{
          candidate: {
            id: "00000000-0000-4000-8000-0000000000aa",
            companyName: "Carya Roastery",
            country: "Kuwait",
            source: "hunter",
            companyScore: 23,
            discoveryStatus: "ready",
            reviewStatus: "approved",
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
          publicCompanyEmail: "info@carya.com",
          peopleJobStatus: "no_result",
        }}
      />,
    );
    expect(screen.getByText("Carya Roastery")).toBeTruthy();
    expect(screen.getByText("Company email")).toBeTruthy();
    expect(screen.getByText("No decision makers found")).toBeTruthy();
    expect(screen.queryByText(/LinkedIn/)).toBeNull();
    expect(screen.getByText(/Directory signal/)).toBeTruthy();
    expect(screen.queryByText(/50% relevance/)).toBeNull();
    expect(screen.queryByText(/Overall 23/)).toBeNull();
    expect(screen.getByRole("link", { name: "Review →" })).toBeTruthy();
    const article = screen.getByText("Carya Roastery").closest("article");
    expect(article?.className).toMatch(/h-fit/);
    expect(article?.className).not.toMatch(/min-h-|h-full|flex-1/);
    expect(screen.queryByText(/Category Manager|Chandan G\./)).toBeNull();
  });

  it("shows a high-priority person without technical scores", () => {
    render(
      <CandidateCard
        record={{
          candidate: {
            id: "00000000-0000-4000-8000-0000000000aa",
            companyName: "KSONS Global",
            country: "United Arab Emirates",
            source: "hunter",
            companyScore: 38,
            discoveryStatus: "ready",
            reviewStatus: "pending",
          },
          productMatches: [],
          contactCount: 2,
          bestContactName: "Chandan G.",
          bestContactTitle: "Director of Agricultural Commodities",
          bestHasLinkedin: true,
          bestIsDecisionMaker: true,
          revealPriority: "high",
          priorityReason: "Agricultural commodities / trading leadership",
          publicCompanyEmail: "info@ksonsglobal.com",
          roleRelevance: 6,
          contactQuality: 11,
        }}
      />,
    );
    expect(screen.getByText("KSONS Global")).toBeTruthy();
    expect(screen.getByText("Chandan G.")).toBeTruthy();
    expect(screen.getByText("High priority")).toBeTruthy();
    expect(screen.getByText("Agricultural commodities / trading leadership")).toBeTruthy();
    expect(screen.getByText("Company email")).toBeTruthy();
    expect(screen.getByText("LinkedIn")).toBeTruthy();
    expect(screen.getByText("2 people found")).toBeTruthy();
    expect(screen.queryByText(/Role score/)).toBeNull();
    expect(screen.queryByText(/Contact quality/)).toBeNull();
    expect(screen.queryByRole("button", { name: /reveal/i })).toBeNull();
  });

  it("marks converted candidates with Buyer created and keeps research", () => {
    render(
      <CandidateCard
        record={{
          candidate: {
            id: "00000000-0000-4000-8000-0000000000aa",
            companyName: "Natureland",
            country: "Kuwait",
            source: "hunter",
            discoveryStatus: "ready",
            reviewStatus: "approved",
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
          contactCount: 1,
          bestContactName: "Ahmed El Din",
          convertedBuyerId: "00000000-0000-4000-8000-0000000000b1",
        }}
      />,
    );
    expect(screen.getByText(/Buyer created/)).toBeTruthy();
    expect(screen.getByText("Ahmed El Din")).toBeTruthy();
    expect(screen.getByText(/Directory signal/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Convert to Buyer" })).toBeNull();
  });
});
