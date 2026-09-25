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
    result: { officialProgramEvidence: "not_checked", productEvidence: "not_available", indiaOrigin: "not_verified", shipmentEvidence: "not_verified", sourcesChecked: 0, automaticSpendRupees: 0 },
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
    expect(screen.getByText("Not available from this source")).toBeTruthy();
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
});
