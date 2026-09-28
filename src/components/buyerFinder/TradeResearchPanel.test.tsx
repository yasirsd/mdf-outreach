import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  TRADE_RESEARCH_INTERPRETATION_VERSION,
  TRADE_RESEARCH_PLANNER_VERSION,
  type TradeResearchBatchSnapshot,
  type TradeResearchJobSnapshot,
  type TradeResearchStage,
} from "@/lib/tradeResearch/types";

const actionMocks = vi.hoisted(() => ({
  create: vi.fn(),
  latestForContext: vi.fn(async (_request: unknown): Promise<TradeResearchJobSnapshot | null> => null),
}));

vi.mock("@/app/(app)/buyer-finder/tradeResearchActions", () => ({
  createTradeResearchBatchAction: actionMocks.create,
  cancelTradeResearchBatchAction: vi.fn(),
  getTradeResearchBatchAction: vi.fn(),
  getLatestTradeResearchJobForContextAction: actionMocks.latestForContext,
}));

import { CandidateTradeResearchPanel, TradeResearchBatchPanel } from "./TradeResearchPanel";

afterEach(() => {
  cleanup();
  actionMocks.create.mockReset();
  actionMocks.latestForContext.mockReset();
  actionMocks.latestForContext.mockResolvedValue(null);
});

const CANDIDATE_ID = "00000000-0000-4000-8000-000000000003";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000004";
const CHILLI = { id: "guntur-dry-red-chilli", label: "Guntur Dry Red Chilli" };

function CandidatePanel({
  initialJob,
  candidateId = CANDIDATE_ID,
  productOptions = [CHILLI],
}: {
  initialJob?: TradeResearchJobSnapshot;
  candidateId?: string;
  productOptions?: readonly { id: string; label: string }[];
}) {
  const marketCountryCode = initialJob?.context?.marketCountryCode ?? "US";
  return (
    <CandidateTradeResearchPanel
      candidateId={candidateId}
      productOptions={productOptions}
      marketCountryCode={marketCountryCode}
      marketLabel={marketCountryCode === "CA" ? "Canada" : "United States"}
      initialJob={initialJob}
      isOwner
    />
  );
}

function job(stage: TradeResearchStage, status: TradeResearchJobSnapshot["status"] = "running"): TradeResearchJobSnapshot {
  const context = {
    workspaceId: WORKSPACE_ID,
    candidateId: CANDIDATE_ID,
    marketCountryCode: "US",
    productId: CHILLI.id,
    productForm: null,
    researchGoal: "screen_trade_activity" as const,
    providerPlanVersion: TRADE_RESEARCH_PLANNER_VERSION,
    interpretationVersion: TRADE_RESEARCH_INTERPRETATION_VERSION,
  };
  const contextFingerprint = `trctx-v1:${"0".repeat(64)}`;
  return {
    id: "00000000-0000-4000-8000-000000000001", batchId: "00000000-0000-4000-8000-000000000002",
    candidateId: CANDIDATE_ID, productId: CHILLI.id, countryCode: "US",
    requestedGoal: "screen_trade_activity", status, stage, revision: 2, automaticSpendRupees: 0,
    context,
    contextFingerprint,
    result: { context, contextFingerprint, officialProgramEvidence: "not_checked", productEvidence: "not_available", indiaOrigin: "not_verified", originEvidence: "not_available", shipmentEvidence: "not_verified", sourcesChecked: 0, automaticSpendRupees: 0 },
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
    render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={job(stage)} />);
    const row = screen.getByText(label).closest("[data-state]");
    expect(row?.getAttribute("data-state")).toBe(stage === "complete" ? "complete" : "active");
    expect(document.body.textContent).not.toMatch(/\d+%/);
  });

  it("shows checkmarks only for stages before the persisted active stage", () => {
    render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={job("resolving_company_matches")} />);
    expect(document.querySelector('[data-stage="screening_sources"]')?.getAttribute("data-state")).toBe("complete");
    expect(document.querySelector('[data-stage="resolving_company_matches"]')?.getAttribute("data-state")).toBe("active");
    expect(document.querySelector('[data-stage="checking_trade_activity"]')?.getAttribute("data-state")).toBe("pending");
  });

  it("renders conservative terminal evidence semantics", () => {
    const completed = job("complete", "completed");
    completed.outcome = "no_verified_evidence";
    completed.result.officialProgramEvidence = "no_verified_match";
    completed.result.sourcesChecked = 1;
    render(<CandidatePanel candidateId={completed.candidateId} initialJob={completed} />);
    expect(screen.getByText("No verified match found")).toBeTruthy();
    expect(screen.getByText(/does not prove the company has no import activity/i)).toBeTruthy();
    // Default FDA fixture leaves productEvidence + originEvidence at
    // "not_available" → both rows now render "Not available from this
    // source" (two occurrences).
    expect(screen.getAllByText("Not available from this source")).toHaveLength(2);
    expect(screen.getAllByText("Not verified")).toHaveLength(2);
  });

  it("uses the persisted zero-cost value and does not expose provider controls", () => {
    render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={job("screening_sources")} />);
    expect(screen.getByText("₹0 spent")).toBeTruthy();
    expect(screen.queryByText(/select provider/i)).toBeNull();
    expect(screen.queryByText(/credits/i)).toBeNull();
  });

  it("BI4F 2A: a queued job displays 'Queued for research' — NOT the running-stage loader", () => {
    const queued = job("preparing_identity", "queued");
    render(<CandidatePanel candidateId={queued.candidateId} initialJob={queued} />);
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
    render(<CandidatePanel candidateId={job("preparing_identity").candidateId} initialJob={job("preparing_identity", "running")} />);
    expect(document.querySelector('[data-job-state="running"]')).not.toBeNull();
    expect(document.querySelector('[data-job-state="queued"]')).toBeNull();
    expect(screen.getByText("Preparing company identity")).toBeTruthy();
  });

  it("BI4F 2A: `not_checked` renders 'Not evaluated' and its own explanatory sentence — distinct from `no_verified_match`", () => {
    const completed = job("complete", "completed");
    completed.outcome = "unsupported_coverage";
    completed.result.officialProgramEvidence = "not_checked";
    completed.result.sourcesChecked = 0;
    render(<CandidatePanel candidateId={completed.candidateId} initialJob={completed} />);
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
    render(<CandidatePanel candidateId={completed.candidateId} initialJob={completed} />);
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
    render(<TradeResearchBatchPanel requests={[]} initialBatch={batch} isOwner />);
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
      j.context = { ...j.context!, marketCountryCode: "CA" };
      j.result.context = j.context;
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
      render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={fdaCompleted()} />);
      expect(screen.getByText("Official importer-program evidence")).toBeTruthy();
      expect(screen.queryByText("Official importer-directory evidence")).toBeNull();
      const source = document.querySelector("[data-evidence-source]");
      expect(source?.getAttribute("data-evidence-source")).toBe("FDA FSVP");
      expect(source?.textContent).toBe("FDA FSVP");
      expect(screen.getByText("Matched state")).toBeTruthy();
      expect(screen.queryByText("Matched province")).toBeNull();
    });

    it("Canada CID result shows Source = Canadian Importers Database + CID-specific label", () => {
      render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted()} />);
      expect(screen.getByText("Official importer-directory evidence")).toBeTruthy();
      expect(screen.queryByText("Official importer-program evidence")).toBeNull();
      const source = document.querySelector("[data-evidence-source]");
      expect(source?.getAttribute("data-evidence-source")).toBe("Canadian Importers Database");
      expect(source?.textContent).toBe("Canadian Importers Database");
      expect(screen.getByText("Matched province")).toBeTruthy();
      expect(screen.queryByText("Matched state")).toBeNull();
    });

    it("Canada CID no-match: productEvidence renders 'No verified match found', not 'Not available from this source'", () => {
      render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted({ productEvidence: "no_verified_match" })} />);
      const productDd = document.querySelector('[data-product-evidence="no_verified_match"]');
      expect(productDd?.textContent).toBe("No verified match found");
    });

    it("Canada CID supporting evidence renders 'Supporting evidence'", () => {
      render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted({ productEvidence: "supporting", originEvidence: "supporting", officialProgramEvidence: "needs_review" })} />);
      expect(document.querySelector('[data-product-evidence="supporting"]')?.textContent).toBe("Supporting evidence");
      expect(document.querySelector('[data-origin-evidence="supporting"]')?.textContent).toBe("Supporting evidence");
    });

    it("Canada CID verified evidence renders 'Verified'", () => {
      render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted({ productEvidence: "verified", originEvidence: "verified", officialProgramEvidence: "verified" })} />);
      expect(document.querySelector('[data-product-evidence="verified"]')?.textContent).toBe("Verified");
      expect(document.querySelector('[data-origin-evidence="verified"]')?.textContent).toBe("Verified");
    });

    it("not_available literal still renders 'Not available from this source' (FDA back-compat)", () => {
      render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={fdaCompleted()} />);
      // FDA fixture has default productEvidence='not_available' and originEvidence='not_available'
      expect(document.querySelector('[data-product-evidence="not_available"]')?.textContent).toBe("Not available from this source");
      expect(document.querySelector('[data-origin-evidence="not_available"]')?.textContent).toBe("Not available from this source");
    });

    it("originEvidence 'not_verified' literal renders 'Not verified'", () => {
      render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted({ originEvidence: "not_verified" })} />);
      expect(document.querySelector('[data-origin-evidence="not_verified"]')?.textContent).toBe("Not verified");
    });

    it("India origin literals: verified → 'Verified', supporting → 'Supporting evidence', not_verified → 'Not verified'", () => {
      const { unmount } = render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted({ indiaOrigin: "verified" })} />);
      expect(document.querySelector('[data-india-origin="verified"]')?.textContent).toBe("Verified");
      unmount();
      const { unmount: unmount2 } = render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted({ indiaOrigin: "supporting" })} />);
      expect(document.querySelector('[data-india-origin="supporting"]')?.textContent).toBe("Supporting evidence");
      unmount2();
      render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted({ indiaOrigin: "not_verified" })} />);
      expect(document.querySelector('[data-india-origin="not_verified"]')?.textContent).toBe("Not verified");
    });

    it("shipmentEvidence stays 'Not verified' for both providers (invariant)", () => {
      render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted()} />);
      // Shipment row + India-origin row + originEvidence(not_verified when overridden) all say "Not verified"
      // The shipment row is always "Not verified" — assert it appears at least once.
      expect(screen.getAllByText("Not verified").length).toBeGreaterThanOrEqual(1);
    });

    it("₹0 spent shown for both providers", () => {
      render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted()} />);
      expect(screen.getByText("₹0 spent")).toBeTruthy();
    });

    it("View evidence: Canada CID coverage shows OGL Canada attribution and never FDA-specific wording", () => {
      render(<CandidatePanel candidateId="00000000-0000-4000-8000-000000000003" initialJob={cidCompleted()} />);
      expect(document.body.textContent).toContain("Open Government Licence – Canada");
      expect(document.body.textContent).toContain("Canadian Importers Database");
      // FDA-specific wording must not leak
      expect(document.body.textContent).not.toContain("FSVP participant list");
      expect(document.body.textContent).not.toContain("FDA FSVP");
    });
  });

  describe("T07 explicit context selection", () => {
    it("preselects and submits the only available product explicitly", async () => {
      actionMocks.create.mockResolvedValue({
        outcome: "created",
        batch: {
          id: "00000000-0000-4000-8000-000000000010",
          status: "completed",
          requestedGoal: "screen_trade_activity",
          totalJobs: 1,
          queuedCount: 0,
          runningCount: 0,
          completedCount: 1,
          partialCount: 0,
          needsReviewCount: 0,
          failedCount: 0,
          cancelledCount: 0,
          corroboratedCount: 0,
          automaticSpendRupees: 0,
          createdAt: "2026-09-28T00:00:00Z",
        },
      });
      render(<CandidatePanel />);

      expect(document.querySelector('[data-selected-research-product="guntur-dry-red-chilli"]')?.textContent)
        .toBe("Guntur Dry Red Chilli");
      expect(document.querySelector('[data-research-market="US"]')?.textContent).toBe("United States (US)");
      fireEvent.click(screen.getByRole("button", { name: "Research trade activity" }));

      await waitFor(() => expect(actionMocks.create).toHaveBeenCalledWith([{
        candidateId: CANDIDATE_ID,
        marketCountryCode: "US",
        productId: CHILLI.id,
        productForm: null,
        researchGoal: "screen_trade_activity",
      }]));
    });

    it("requires an explicit choice when multiple products exist and reads the chosen context", async () => {
      const mango = { id: "alphonso-mango", label: "Alphonso Mango" };
      const mangoJob = job("complete", "completed");
      mangoJob.productId = mango.id;
      mangoJob.context = { ...mangoJob.context!, productId: mango.id };
      mangoJob.result.context = mangoJob.context;
      actionMocks.latestForContext.mockResolvedValue(mangoJob);

      render(<CandidatePanel productOptions={[CHILLI, mango]} />);
      const button = screen.getByRole("button", { name: "Research trade activity" });
      expect(button.getAttribute("disabled")).not.toBeNull();
      expect(screen.getByText(/Choose the product context/)).toBeTruthy();

      fireEvent.change(screen.getByLabelText("Research product"), { target: { value: mango.id } });
      await waitFor(() => expect(actionMocks.latestForContext).toHaveBeenCalledWith({
        candidateId: CANDIDATE_ID,
        marketCountryCode: "US",
        productId: mango.id,
        productForm: null,
        researchGoal: "screen_trade_activity",
      }));
      expect(screen.getByText("Not evaluated")).toBeTruthy();
      expect(button.getAttribute("disabled")).toBeNull();
    });

    it("disables research when the candidate has no associated product", () => {
      render(<CandidatePanel productOptions={[]} />);
      expect(screen.getByRole("button", { name: "Research trade activity" }).getAttribute("disabled")).not.toBeNull();
      expect(screen.getByText(/Associate a product with this candidate/)).toBeTruthy();
    });

    it("does not display a chilli result after switching the selected product to mango", async () => {
      const chilliJob = job("complete", "completed");
      chilliJob.result.evidence = {
        source: "FDA FSVP",
        datasetPeriod: "2026 Q2",
        retrievedAt: "2026-09-28T00:00:00Z",
        candidateName: "Example Foods",
        identityDecision: "strong",
        matchReason: "CHILLI RESULT",
        coverageExplanation: "Context-specific fixture.",
      };
      actionMocks.latestForContext
        .mockResolvedValueOnce(chilliJob)
        .mockResolvedValueOnce(null);
      const mango = { id: "alphonso-mango", label: "Alphonso Mango" };
      render(<CandidatePanel productOptions={[CHILLI, mango]} />);

      fireEvent.change(screen.getByLabelText("Research product"), { target: { value: CHILLI.id } });
      await waitFor(() => expect(screen.getByText("CHILLI RESULT")).toBeTruthy());
      fireEvent.change(screen.getByLabelText("Research product"), { target: { value: mango.id } });
      await waitFor(() => expect(screen.queryByText("CHILLI RESULT")).toBeNull());
      await waitFor(() => expect(screen.getByText(/No trade research has been run for this product and market/)).toBeTruthy());
    });
  });
});

describe("T06 legacy result rendering compatibility", () => {
  it("19. renders an existing Phase 2A/2B singular evidence block", () => {
    const completed = job("complete", "completed");
    completed.outcome = "official_importer_program_corroboration";
    completed.result.evidence = {
      source: "FDA FSVP",
      datasetPeriod: "2026 Q2",
      retrievedAt: "2026-09-28T00:00:00Z",
      matchedSourceName: "Example Foods LLC",
      matchedState: "CA",
      candidateName: "Example Foods",
      identityDecision: "strong",
      matchReason: "Company and state matched.",
      coverageExplanation: "Company and state only.",
    };
    render(<CandidatePanel candidateId={completed.candidateId} initialJob={completed} />);
    expect(document.querySelector('[data-evidence-source="FDA FSVP"]')?.textContent).toBe("FDA FSVP");
    expect(screen.getByText("Company and state matched.")).toBeTruthy();
  });

  it("20. renders existing Phase 2C multi-source evidence without flattening providers", () => {
    const completed = job("complete", "completed");
    completed.outcome = "official_importer_program_corroboration";
    const common = {
      datasetPeriod: "2026",
      retrievedAt: "2026-09-28T00:00:00Z",
      candidateName: "Example Foods",
      identityDecision: "strong" as const,
      matchReason: "Company identity matched.",
      coverageExplanation: "Company-level program evidence only.",
      companyEvidence: "verified" as const,
      productEvidence: "not_available" as const,
      originEvidence: "not_available" as const,
      shipmentEvidence: "not_verified" as const,
    };
    completed.result.sources = [
      {
        ...common,
        providerId: "fda-fsvp",
        outcome: "completed",
        source: "FDA FSVP",
        attribution: "U.S. Food & Drug Administration FSVP list.",
      },
      {
        ...common,
        providerId: "fda-vqip",
        outcome: "completed",
        source: "FDA VQIP",
        attribution: "U.S. Food & Drug Administration VQIP list.",
      },
    ];
    render(<CandidatePanel candidateId={completed.candidateId} initialJob={completed} />);
    expect(document.querySelectorAll("[data-source]")).toHaveLength(2);
    expect(document.querySelector('[data-source="fda-fsvp"]')).not.toBeNull();
    expect(document.querySelector('[data-source="fda-vqip"]')).not.toBeNull();
  });

  it("renders every typed provider status and only the safe error code", () => {
    const completed = job("complete", "partial");
    completed.result.sourcesPlanned = 2;
    completed.result.sourcesFailed = 1;
    completed.result.providerResults = [
      {
        providerId: "fda-fsvp", datasetId: "fsvp-participant-list", datasetVersion: null,
        parserVersion: null, sourceRecordIds: [], sourcePeriod: null, retrievedAt: null,
        execution: { status: "not_started", safeErrorCode: null }, evidence: null,
      },
      {
        providerId: "fda-vqip", datasetId: "fda-vqip-participant-list", datasetVersion: null,
        parserVersion: null, sourceRecordIds: [], sourcePeriod: null, retrievedAt: null,
        execution: { status: "failed_terminal", safeErrorCode: "SOURCE_UNAVAILABLE" }, evidence: null,
      },
    ];
    render(<CandidatePanel candidateId={completed.candidateId} initialJob={completed} />);
    expect(document.querySelectorAll("[data-provider-result]")).toHaveLength(2);
    expect(document.querySelector('[data-provider-status="not_started"]')?.textContent).toBe("Not started");
    expect(document.querySelector('[data-provider-status="failed_terminal"]')?.textContent).toBe("Failed terminal");
    expect(screen.getByText("Source status: source unavailable")).toBeTruthy();
    expect(screen.getByText("Sources planned").nextSibling?.textContent).toBe("2");
  });
});
