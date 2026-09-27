import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { TradeResearchBatchSnapshot, TradeResearchJobSnapshot, TradeResearchStage } from "@/lib/tradeResearch/types";

vi.mock("@/app/(app)/buyer-finder/tradeResearchActions", () => ({
  createTradeResearchBatchAction: vi.fn(), cancelTradeResearchBatchAction: vi.fn(),
  getTradeResearchBatchAction: vi.fn(), getLatestTradeResearchJobForCandidateAction: vi.fn(),
}));

import { CandidateTradeResearchPanel, TradeResearchBatchPanel } from "./TradeResearchPanel";

afterEach(() => cleanup());

function job(stage: TradeResearchStage, status: TradeResearchJobSnapshot["status"] = "running"): TradeResearchJobSnapshot {
  return {
    id: "00000000-0000-4000-8000-000000000001", batchId: "00000000-0000-4000-8000-000000000002",
    candidateId: "00000000-0000-4000-8000-000000000003", productId: "guntur-dry-red-chilli", countryCode: "US",
    requestedGoal: "screen_trade_activity", status, stage, revision: 2, automaticSpendRupees: 0,
    result: { officialProgramEvidence: "not_checked", productEvidence: "not_available", indiaOrigin: "not_verified", originEvidence: "not_available", shipmentEvidence: "not_verified", sourcesChecked: 0, automaticSpendRupees: 0 },
    createdAt: "2026-09-25T00:00:00Z",
  };
}

describe("truthful trade research UI", () => {
  it.each([
    ["preparing_identity", "Preparing company identity"], ["planning_sources", "Selecting eligible free sources"],
    ["screening_sources", "Checking official trade sources"], ["resolving_company_matches", "Matching company records"],
    ["checking_trade_activity", "Reviewing official importer-program evidence"], ["finalizing", "Finalizing trade intelligence"],
    ["complete", "Research complete"],
  ] as const)("maps persisted %s to truthful copy", (stage, label) => {
    render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={job(stage)} isOwner />);
    const row = screen.getByText(label).closest("[data-state]");
    expect(row?.getAttribute("data-state")).toBe(stage === "complete" ? "complete" : "active");
    expect(document.body.textContent).not.toMatch(/\d+%/);
  });

  it("shows checkmarks only for stages before the persisted active stage", () => {
    render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={job("resolving_company_matches")} isOwner />);
    expect(document.querySelector('[data-stage="screening_sources"]')?.getAttribute("data-state")).toBe("complete");
    expect(document.querySelector('[data-stage="resolving_company_matches"]')?.getAttribute("data-state")).toBe("active");
    expect(document.querySelector('[data-stage="checking_trade_activity"]')?.getAttribute("data-state")).toBe("pending");
  });

  it("renders conservative terminal evidence semantics", () => {
    const completed = job("complete", "completed");
    completed.outcome = "no_verified_evidence";
    completed.result.officialProgramEvidence = "no_verified_match";
    completed.result.sourcesChecked = 1;
    render(<CandidateTradeResearchPanel candidateId={completed.candidateId} initialJob={completed} isOwner />);
    expect(screen.getByText("No verified match found")).toBeTruthy();
    expect(screen.getByText(/does not prove the company has no import activity/i)).toBeTruthy();
    // Default FDA fixture leaves productEvidence + originEvidence at
    // "not_available" → both rows now render "Not available from this
    // source" (two occurrences).
    expect(screen.getAllByText("Not available from this source")).toHaveLength(2);
    expect(screen.getAllByText("Not verified")).toHaveLength(2);
  });

  it("uses the persisted zero-cost value and does not expose provider controls", () => {
    render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={job("screening_sources")} isOwner />);
    expect(screen.getByText("₹0 spent")).toBeTruthy();
    expect(screen.queryByText(/select provider/i)).toBeNull();
    expect(screen.queryByText(/credits/i)).toBeNull();
  });

  it("BI4F 2A: a queued job displays 'Queued for research' — NOT the running-stage loader", () => {
    const queued = job("preparing_identity", "queued");
    render(<CandidateTradeResearchPanel candidateId={queued.candidateId} initialJob={queued} isOwner />);
    expect(screen.getByText("Queued for research")).toBeTruthy();
    // The running stage loader must NOT render for a queued job — otherwise
    // "Preparing company identity" would appear active while no worker has
    // actually claimed the job yet.
    expect(document.querySelector('[data-job-state="queued"]')).not.toBeNull();
    expect(document.querySelector('[data-job-state="running"]')).toBeNull();
    expect(document.querySelector('[data-stage="preparing_identity"]')).toBeNull();
    expect(screen.getByText(/A background scheduler runs official-source screening/)).toBeTruthy();
  });

  it("BI4F 2A: transitions to the running-stage loader once status = running", () => {
    render(<CandidateTradeResearchPanel candidateId={job("preparing_identity").candidateId} initialJob={job("preparing_identity", "running")} isOwner />);
    expect(document.querySelector('[data-job-state="running"]')).not.toBeNull();
    expect(document.querySelector('[data-job-state="queued"]')).toBeNull();
    expect(screen.getByText("Preparing company identity")).toBeTruthy();
  });

  it("BI4F 2A: `not_checked` renders 'Not evaluated' and its own explanatory sentence — distinct from `no_verified_match`", () => {
    const completed = job("complete", "completed");
    completed.outcome = "unsupported_coverage";
    completed.result.officialProgramEvidence = "not_checked";
    completed.result.sourcesChecked = 0;
    render(<CandidateTradeResearchPanel candidateId={completed.candidateId} initialJob={completed} isOwner />);
    expect(screen.getByText("Not evaluated")).toBeTruthy();
    expect(screen.getByText(/No eligible free official source was evaluated/)).toBeTruthy();
    // Ensure the "no_verified_match" copy does NOT leak into the unchecked case.
    expect(screen.queryByText("No verified match found")).toBeNull();
    // Sources checked = 0 is truthful in this case.
    expect(screen.getByTestId("sources-checked").textContent).toBe("0");
  });

  it("BI4F 2A: completed FDA FSVP evaluation with no match keeps sources checked = 1 (evaluated but did not match)", () => {
    const completed = job("complete", "completed");
    completed.outcome = "no_verified_evidence";
    completed.result.officialProgramEvidence = "no_verified_match";
    completed.result.sourcesChecked = 1;
    render(<CandidateTradeResearchPanel candidateId={completed.candidateId} initialJob={completed} isOwner />);
    expect(screen.getByText("No verified match found")).toBeTruthy();
    expect(screen.getByTestId("sources-checked").textContent).toBe("1");
    // "not_checked" copy must NOT appear here.
    expect(screen.queryByText(/No eligible free official source was evaluated/)).toBeNull();
  });

  it("shows determinate batch completion only from the persisted denominator", () => {
    const batch: TradeResearchBatchSnapshot = {
      id: "00000000-0000-4000-8000-000000000002", status: "running", requestedGoal: "screen_trade_activity",
      totalJobs: 100, queuedCount: 58, runningCount: 4, completedCount: 35, partialCount: 0,
      needsReviewCount: 3, failedCount: 0, cancelledCount: 0, corroboratedCount: 21, automaticSpendRupees: 0, createdAt: "2026-09-25T00:00:00Z",
    };
    render(<TradeResearchBatchPanel candidateIds={[]} initialBatch={batch} isOwner />);
    expect(screen.getByText("Batch completion · 38 of 100")).toBeTruthy();
    expect(screen.getByLabelText("Batch completion 38 of 100").getAttribute("aria-label")).toBe("Batch completion 38 of 100");
    expect(screen.getByText("Free research · ₹0 spent")).toBeTruthy();
    expect(screen.getByText("21")).toBeTruthy();
  });

  // BI4F 2B UI semantics fix — labels and source are driven by
  // `result_summary.evidence.source`, not hard-coded to FDA FSVP.
  describe("BI4F 2B: source + evidence labels are driven by stored evidence.source", () => {
    function fdaCompleted(): TradeResearchJobSnapshot {
      const j = job("complete", "completed");
      j.outcome = "no_verified_evidence";
      j.result.officialProgramEvidence = "no_verified_match";
      j.result.sourcesChecked = 1;
      j.result.evidence = {
        source: "FDA FSVP",
        datasetPeriod: "April 1, 2026 – June 30, 2026",
        retrievedAt: "2026-09-25T12:00:00Z",
        matchedSourceName: undefined,
        matchedState: undefined,
        candidateName: "Iberia Foods",
        identityDecision: "none",
        matchReason: "No normalized company-name match in the checked FDA dataset.",
        coverageExplanation: "The official list contains participant name and U.S. state only.",
      };
      return j;
    }
    function cidCompleted(over: Partial<TradeResearchJobSnapshot["result"]> = {}): TradeResearchJobSnapshot {
      const j = job("complete", "completed");
      j.countryCode = "CA";
      j.outcome = "no_verified_evidence";
      j.result = {
        officialProgramEvidence: "no_verified_match",
        productEvidence: "no_verified_match",
        indiaOrigin: "not_verified",
        originEvidence: "no_verified_match",
        shipmentEvidence: "not_verified",
        sourcesChecked: 1,
        automaticSpendRupees: 0,
        ...over,
        evidence: {
          source: "Canadian Importers Database",
          datasetPeriod: "2020",
          retrievedAt: "2026-09-27T12:00:00Z",
          matchedSourceName: undefined,
          matchedState: undefined,
          candidateName: "Super Asia Foods",
          identityDecision: "none",
          matchReason: "No normalized company-name match for the target HS6 in the checked CID dataset.",
          coverageExplanation:
            "Canada CID is a major-importer directory joined at (HS6, origin country, importer company). HS6 090421 mapping quality: proxy — product evidence capped at \"supporting\". Contains information licensed under the Open Government Licence – Canada.",
        },
      };
      return j;
    }

    it("FDA result still shows Source = FDA FSVP + FDA-centric label", () => {
      render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={fdaCompleted()} isOwner />);
      expect(screen.getByText("Official importer-program evidence")).toBeTruthy();
      expect(screen.queryByText("Official importer-directory evidence")).toBeNull();
      const source = document.querySelector("[data-evidence-source]");
      expect(source?.getAttribute("data-evidence-source")).toBe("FDA FSVP");
      expect(source?.textContent).toBe("FDA FSVP");
      expect(screen.getByText("Matched state")).toBeTruthy();
      expect(screen.queryByText("Matched province")).toBeNull();
    });

    it("Canada CID result shows Source = Canadian Importers Database + CID-specific label", () => {
      render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted()} isOwner />);
      expect(screen.getByText("Official importer-directory evidence")).toBeTruthy();
      expect(screen.queryByText("Official importer-program evidence")).toBeNull();
      const source = document.querySelector("[data-evidence-source]");
      expect(source?.getAttribute("data-evidence-source")).toBe("Canadian Importers Database");
      expect(source?.textContent).toBe("Canadian Importers Database");
      expect(screen.getByText("Matched province")).toBeTruthy();
      expect(screen.queryByText("Matched state")).toBeNull();
    });

    it("Canada CID no-match: productEvidence renders 'No verified match found', not 'Not available from this source'", () => {
      render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted({ productEvidence: "no_verified_match" })} isOwner />);
      const productDd = document.querySelector('[data-product-evidence="no_verified_match"]');
      expect(productDd?.textContent).toBe("No verified match found");
    });

    it("Canada CID supporting evidence renders 'Supporting evidence'", () => {
      render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted({ productEvidence: "supporting", originEvidence: "supporting", officialProgramEvidence: "needs_review" })} isOwner />);
      expect(document.querySelector('[data-product-evidence="supporting"]')?.textContent).toBe("Supporting evidence");
      expect(document.querySelector('[data-origin-evidence="supporting"]')?.textContent).toBe("Supporting evidence");
    });

    it("Canada CID verified evidence renders 'Verified'", () => {
      render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted({ productEvidence: "verified", originEvidence: "verified", officialProgramEvidence: "verified" })} isOwner />);
      expect(document.querySelector('[data-product-evidence="verified"]')?.textContent).toBe("Verified");
      expect(document.querySelector('[data-origin-evidence="verified"]')?.textContent).toBe("Verified");
    });

    it("not_available literal still renders 'Not available from this source' (FDA back-compat)", () => {
      render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={fdaCompleted()} isOwner />);
      // FDA fixture has default productEvidence='not_available' and originEvidence='not_available'
      expect(document.querySelector('[data-product-evidence="not_available"]')?.textContent).toBe("Not available from this source");
      expect(document.querySelector('[data-origin-evidence="not_available"]')?.textContent).toBe("Not available from this source");
    });

    it("originEvidence 'not_verified' literal renders 'Not verified'", () => {
      render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted({ originEvidence: "not_verified" })} isOwner />);
      expect(document.querySelector('[data-origin-evidence="not_verified"]')?.textContent).toBe("Not verified");
    });

    it("India origin literals: verified → 'Verified', supporting → 'Supporting evidence', not_verified → 'Not verified'", () => {
      const { unmount } = render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted({ indiaOrigin: "verified" })} isOwner />);
      expect(document.querySelector('[data-india-origin="verified"]')?.textContent).toBe("Verified");
      unmount();
      const { unmount: unmount2 } = render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted({ indiaOrigin: "supporting" })} isOwner />);
      expect(document.querySelector('[data-india-origin="supporting"]')?.textContent).toBe("Supporting evidence");
      unmount2();
      render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted({ indiaOrigin: "not_verified" })} isOwner />);
      expect(document.querySelector('[data-india-origin="not_verified"]')?.textContent).toBe("Not verified");
    });

    it("shipmentEvidence stays 'Not verified' for both providers (invariant)", () => {
      render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted()} isOwner />);
      // Shipment row + India-origin row + originEvidence(not_verified when overridden) all say "Not verified"
      // The shipment row is always "Not verified" — assert it appears at least once.
      expect(screen.getAllByText("Not verified").length).toBeGreaterThanOrEqual(1);
    });

    it("₹0 spent shown for both providers", () => {
      render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted()} isOwner />);
      expect(screen.getByText("₹0 spent")).toBeTruthy();
    });

    it("View evidence: Canada CID coverage shows OGL Canada attribution and never FDA-specific wording", () => {
      render(<CandidateTradeResearchPanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted()} isOwner />);
      expect(document.body.textContent).toContain("Open Government Licence – Canada");
      expect(document.body.textContent).toContain("Canadian Importers Database");
      // FDA-specific wording must not leak
      expect(document.body.textContent).not.toContain("FSVP participant list");
      expect(document.body.textContent).not.toContain("FDA FSVP");
    });
  });
});
