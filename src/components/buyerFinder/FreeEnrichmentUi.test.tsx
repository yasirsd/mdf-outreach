import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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
import { FreeEnrichmentSummaryPanel } from "./FreeEnrichmentSummaryPanel";
import { FreeEnrichmentAutopump } from "./FreeEnrichmentAutopump";
import { QueueView } from "@/app/(app)/buyer-finder/QueueView";

afterEach(() => cleanup());

const baseCandidate = {
  id: "00000000-0000-4000-8000-0000000000aa",
  companyName: "ABC Foods",
  country: "United Arab Emirates",
  source: "hunter" as const,
  companyScore: 40,
  discoveryStatus: "ready" as const,
  reviewStatus: "pending" as const,
};

describe("BF4R review workspace", () => {
  it("renders the free-research summary without fake percentages", () => {
    render(
      <FreeEnrichmentSummaryPanel
        summary={{
          companies: 45,
          ready: 33,
          researching: 0,
          needsAttention: 12,
          checksRemaining: 0,
          companiesWithPublicEmail: 20,
          peopleFound: 51,
          highRevealPriority: 2,
          complete: 33,
          inProgress: 0,
          retrying: 0,
          queued: 0,
          publicEmailsFound: 27,
          decisionMakersFound: 51,
        }}
      />,
    );
    expect(screen.getByText("Free research")).toBeTruthy();
    expect(screen.getByText("45 companies")).toBeTruthy();
    expect(screen.getByText("Companies with public email")).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy();
    expect(screen.getByText("High-priority contacts")).toBeTruthy();
    expect(screen.getByText("Research complete · 12 need attention")).toBeTruthy();
    expect(screen.getByLabelText("33 ready and 12 need attention of 45 companies")).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("ranks HIGH before MEDIUM and excludes LOW from Priority contacts", () => {
    render(
      <QueueView
        rows={[
          {
            candidate: { ...baseCandidate, companyName: "KSONS Global", country: "United Arab Emirates" },
            productMatches: [],
            contactCount: 2,
            revealPriority: "high",
            bestContactName: "Chandan G.",
            bestContactTitle: "Director of Agricultural Commodities",
            bestHasLinkedin: true,
            publicCompanyEmail: "info@ksonsglobal.com",
          },
          {
            candidate: {
              ...baseCandidate,
              id: "00000000-0000-4000-8000-0000000000dd",
              companyName: "Natureland",
              country: "Kuwait",
            },
            productMatches: [],
            contactCount: 6,
            revealPriority: "high",
            bestContactName: "Ahmed E.",
            bestContactTitle: "Category Manager",
            bestHasLinkedin: true,
          },
          {
            candidate: {
              ...baseCandidate,
              id: "00000000-0000-4000-8000-0000000000cc",
              companyName: "Medium Co",
            },
            productMatches: [],
            contactCount: 1,
            revealPriority: "medium",
            bestContactName: "Pat M.",
            bestContactTitle: "Managing Director",
          },
          {
            candidate: { ...baseCandidate, id: "00000000-0000-4000-8000-0000000000bb", companyName: "Low Co" },
            productMatches: [],
            contactCount: 1,
            revealPriority: "low",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Priority contacts" }));
    expect(screen.getByText("Chandan G.")).toBeTruthy();
    expect(screen.getByText("Ahmed E.")).toBeTruthy();
    expect(screen.getByText("Agricultural commodities / trading leadership")).toBeTruthy();
    expect(screen.getByText("Category management / buying role")).toBeTruthy();
    expect(screen.getByText("KSONS Global · UAE")).toBeTruthy();
    expect(screen.getByText(/Natureland · Kuwait/)).toBeTruthy();
    expect(screen.getByText("Pat M.")).toBeTruthy();
    expect(screen.queryByText("Low Co")).toBeNull();
    expect(screen.queryByRole("button", { name: /reveal/i })).toBeNull();
    const text = document.body.textContent ?? "";
    expect(text.indexOf("Chandan G.")).toBeLessThan(text.indexOf("Pat M."));
    expect(text.indexOf("Ahmed E.")).toBeLessThan(text.indexOf("Pat M."));
  });

  it("shows one website issue representation when people succeeded", () => {
    render(
      <QueueView
        rows={[
          {
            candidate: { ...baseCandidate, companyName: "Dry Fruit Hub", country: "Kuwait" },
            productMatches: [],
            contactCount: 7,
            bestContactTitle: "Director",
            publicJobStatus: "failed",
            peopleJobStatus: "succeeded",
            revealPriority: "medium",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Needs attention" }));
    expect(screen.getByText("Dry Fruit Hub")).toBeTruthy();
    expect(screen.getByText("7 people found")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText(/Website research · Unavailable/)).toBeNull();
    expect(screen.queryByText(/Website research · Needs attention/)).toBeNull();
    expect(screen.getByRole("button", { name: /Retry website/ })).toBeTruthy();
  });

  it("shows a useful empty state for Priority contacts", () => {
    render(
      <QueueView
        rows={[
          {
            candidate: { ...baseCandidate, companyName: "Low Co" },
            productMatches: [],
            contactCount: 1,
            revealPriority: "low",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Priority contacts" }));
    expect(screen.getByText("No priority contacts yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "View all companies" })).toBeTruthy();
  });

  it("keeps the all-companies grid content-sized", () => {
    const { container } = render(
      <QueueView
        rows={[
          {
            candidate: { ...baseCandidate, companyName: "Carya Roastery" },
            productMatches: [],
            contactCount: 0,
            peopleJobStatus: "no_result",
            publicCompanyEmail: "hello@carya.example",
          },
          {
            candidate: {
              ...baseCandidate,
              id: "00000000-0000-4000-8000-0000000000bb",
              companyName: "KSONS Global",
            },
            productMatches: [],
            contactCount: 2,
            revealPriority: "high",
            bestContactName: "Chandan G.",
            bestContactTitle: "Director of Agricultural Commodities",
          },
        ]}
      />,
    );
    const grid = container.querySelector(".grid");
    expect(grid?.className).toMatch(/items-start/);
    expect(grid?.className).toMatch(/content-start/);
  });

  it("drains once on mount even without an enable prop", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ outcome: "ok", claimed: 0, processed: 0, skipped: 2, idle: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<FreeEnrichmentAutopump />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/buyer-finder/free-enrichment/drain");
    vi.unstubAllGlobals();
  });
});
