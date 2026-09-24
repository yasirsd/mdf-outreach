import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SafeSearchRunSnapshot } from "@/lib/buyerFinder/searchRun";
import type { MarketIntelligenceHandoffContext } from "@/lib/marketIntelligence/read/overview";
import type { MarketIntelligenceBuyerFinderHandoff } from "@/lib/marketIntelligence/buyerFinderHandoff";

const refresh = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace }),
}));

const createRun = vi.fn();
const getRun = vi.fn();
const finalizeStale = vi.fn();
vi.mock("./searchRunActions", () => ({
  createBuyerFinderSearchRunAction: (...args: unknown[]) => createRun(...args),
  getBuyerFinderSearchRunAction: (...args: unknown[]) => getRun(...args),
  finalizeStaleBuyerFinderSearchRunAction: (...args: unknown[]) => finalizeStale(...args),
  getLatestActiveBuyerFinderSearchRunAction: vi.fn(),
  executeBuyerFinderSearchRunAction: vi.fn(),
}));

const getUsage = vi.fn(async () => ({ outcome: "ok" as const, usage: null }));
vi.mock("./actions", () => ({
  getHunterUsageAction: () => getUsage(),
}));

import { BuyerFinderView } from "./BuyerFinderView";

afterEach(() => {
  cleanup();
  refresh.mockReset();
  replace.mockReset();
  createRun.mockReset();
  getRun.mockReset();
  finalizeStale.mockReset();
  getUsage.mockReset();
  getUsage.mockResolvedValue({ outcome: "ok", usage: null });
  vi.unstubAllGlobals();
});

const EMPTY_SUMMARY = { total: 0, pending: 0, approved: 0, rejected: 0, archived: 0 };

function snap(over: Partial<SafeSearchRunSnapshot> = {}): SafeSearchRunSnapshot {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    status: "running",
    stage: "discovering",
    provider: "hunter",
    country: "Thailand",
    businessProductId: "guntur-dry-red-chilli",
    discoveredCount: 0,
    usableCount: 0,
    processedCount: 0,
    createdCount: 0,
    enrichedExistingCount: 0,
    duplicateCount: 0,
    productMatchesAdded: 0,
    failureCount: 0,
    creditsUsed: 0,
    costClass: "free",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function renderView(over?: {
  initialActiveRun?: SafeSearchRunSnapshot | null;
  hunterDiscovery?: "not_configured" | "ready";
  marketHandoff?: MarketIntelligenceBuyerFinderHandoff | null;
  marketContext?: MarketIntelligenceHandoffContext;
}) {
  return render(
    <BuyerFinderView
      initialQueue={[]}
      initialSummary={EMPTY_SUMMARY}
      queueLimit={100}
      hunterDiscovery={over?.hunterDiscovery ?? "ready"}
      initialActiveRun={over?.initialActiveRun ?? null}
      initialQuery={over?.marketHandoff ? {
        country: over.marketHandoff.countryName,
        productId: over.marketHandoff.productId,
      } : undefined}
      marketHandoff={over?.marketHandoff}
      marketContext={over?.marketContext}
    />,
  );
}

const marketHandoff: MarketIntelligenceBuyerFinderHandoff = {
  source: "market-intelligence",
  productId: "guntur-dry-red-chilli",
  productName: "Guntur Dry Red Chilli",
  countryAlpha2: "US",
  countryName: "United States",
  returnComparison: ["US", "TH"],
};

const marketContext: MarketIntelligenceHandoffContext = {
  product: { id: "guntur-dry-red-chilli", displayName: "Guntur Dry Red Chilli" },
  country: { alpha2: "US", name: "United States" },
  marketFit: 66,
  dataConfidence: 90,
  recommendationStatus: "indicative",
  mappingKind: "proxy",
  mappingConfidence: 0.7,
  fitEligibility: "proxy_allowed",
  isTradeProxy: true,
  hsRevision: "HS17",
  hsCode: "090421",
  marketFitVersion: "mi-fit-v2",
  dataConfidenceVersion: "mi-conf-v1",
  calculatedAt: "2026-09-23T00:00:00.000Z",
};

describe("BuyerFinderView search-run UX", () => {
  it("prefills a valid Market Intelligence handoff without discovery, usage, or writes", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderView({ marketHandoff, marketContext });
    expect((screen.getByLabelText("Country") as HTMLSelectElement).value).toBe("United States");
    expect((screen.getByLabelText("Product") as HTMLSelectElement).value).toBe("guntur-dry-red-chilli");
    expect(createRun).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getUsage).not.toHaveBeenCalled();
    expect(finalizeStale).not.toHaveBeenCalled();
  });

  it("starts discovery only after the operator explicitly submits the prefilled search", async () => {
    createRun.mockResolvedValue({ outcome: "invalid_input", message: "test stop" });
    renderView({ marketHandoff, marketContext });
    expect(createRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Find buyers" }));
    await waitFor(() => expect(createRun).toHaveBeenCalledWith({
      country: "United States",
      productId: "guntur-dry-red-chilli",
      buyerTypes: undefined,
      contactPriorities: [],
    }));
  });

  it("shows authoritative market-level context and the proxy evidence boundary", () => {
    renderView({ marketHandoff, marketContext });
    expect(screen.getByRole("heading", { name: "United States · Guntur Dry Red Chilli" })).toBeTruthy();
    expect(screen.getByText("66 / 100")).toBeTruthy();
    expect(screen.getByText("90 / 100")).toBeTruthy();
    expect(screen.getByText("Indicative")).toBeTruthy();
    expect(screen.getByText(/Trade proxy · HS17 090421/)).toBeTruthy();
    expect(screen.getByText(/country-level market evidence/)).toBeTruthy();
    expect(screen.getByText(/does not establish that any company/)).toBeTruthy();
  });

  it("shows no fabricated market card when the persisted score is missing", () => {
    renderView({ marketHandoff });
    expect(screen.queryByText("Market-level evidence")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Market Intelligence" })).toBeTruthy();
  });

  it("updates the canonical handoff and hides stale context when country changes", () => {
    renderView({ marketHandoff, marketContext });
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "Thailand" } });
    expect(replace).toHaveBeenCalledWith(
      "/buyer-finder?product=guntur-dry-red-chilli&country=TH&source=market-intelligence",
      { scroll: false },
    );
    expect(screen.queryByRole("heading", { name: "United States · Guntur Dry Red Chilli" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Market Intelligence" }).getAttribute("href")).toBe(
      "/market-intelligence?product=guntur-dry-red-chilli&country=TH",
    );
  });

  it("updates the canonical handoff and hides stale context when product changes", () => {
    renderView({ marketHandoff, marketContext });
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "banganapalli-mango" } });
    expect(replace).toHaveBeenCalledWith(
      "/buyer-finder?product=banganapalli-mango&country=US&source=market-intelligence",
      { scroll: false },
    );
    expect(screen.queryByRole("heading", { name: "United States · Guntur Dry Red Chilli" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Market Intelligence" }).getAttribute("href")).toBe(
      "/market-intelligence?product=banganapalli-mango&country=US",
    );
  });

  it("returns only to a validated canonical Market Intelligence route", () => {
    renderView({ marketHandoff, marketContext });
    expect(screen.getByRole("link", { name: "Back to Market Intelligence" }).getAttribute("href")).toBe(
      "/market-intelligence?product=guntur-dry-red-chilli&country=US&compare=US,TH",
    );
  });

  it("does not finalize a stale prior run merely because a handoff URL was opened", () => {
    renderView({
      marketHandoff,
      marketContext,
      initialActiveRun: snap({
        status: "running",
        updatedAt: "2020-01-01T00:00:00.000Z",
        createdAt: "2020-01-01T00:00:00.000Z",
      }),
    });
    expect(finalizeStale).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });

  it("reconciles a stale handoff run only after the operator chooses Start a new search", async () => {
    const stale = snap({
      status: "running",
      updatedAt: "2020-01-01T00:00:00.000Z",
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    finalizeStale.mockResolvedValue({
      outcome: "finalized",
      run: snap({
        ...stale,
        status: "failed",
        stage: "complete",
        errorCode: "interrupted",
      }),
    });
    renderView({ marketHandoff, marketContext, initialActiveRun: stale });

    expect(finalizeStale).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start a new search" }));

    await waitFor(() => expect(finalizeStale).toHaveBeenCalledWith(stale.id));
    await waitFor(() => expect(screen.getByRole("button", { name: "Find buyers" })).toBeTruthy());
    expect(createRun).not.toHaveBeenCalled();
  });

  it("resumes observing an initial active run without executing Hunter", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderView({ initialActiveRun: snap({ status: "running", stage: "discovering" }) });
    expect(screen.getByText(/Finding companies in Thailand/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Find buyers/i }).hasAttribute("disabled")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });

  it("disables a new search while a healthy run is active", () => {
    renderView({ initialActiveRun: snap({ status: "queued", stage: "preparing" }) });
    expect(screen.getByText(/already running/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Find buyers/i }).hasAttribute("disabled")).toBe(true);
  });

  it("enables a new search after a terminal run", () => {
    renderView({
      initialActiveRun: snap({ status: "completed", stage: "complete", createdCount: 1 }),
    });
    expect(screen.getByText("Search complete")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Find more companies/i }));
    expect(screen.getByRole("button", { name: /Find buyers/i }).hasAttribute("disabled")).toBe(true);
    // Country/product still required — button disabled until fields filled, but not because a run is active.
    expect(screen.queryByText(/already running/i)).toBeNull();
  });

  it("calls router.refresh once when a run becomes terminal via polling", async () => {
    getRun.mockResolvedValue({
      outcome: "ok",
      run: snap({ status: "completed", stage: "complete", createdCount: 2 }),
    });
    vi.stubGlobal("fetch", vi.fn());
    renderView({ initialActiveRun: snap({ status: "running", stage: "processing_candidates" }) });
    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText("Search complete")).toBeTruthy();
    });
  });

  it("disables Find buyers and does not fetch usage when Hunter is not configured", () => {
    renderView({ hunterDiscovery: "not_configured" });
    expect(screen.getByRole("button", { name: /Find buyers/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("Hunter is not configured on this server.").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Discovery · Disabled/)).toBeNull();
    expect(screen.queryByText(/50 credits/)).toBeNull();
    expect(getUsage).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });

  it("describes buyer type as search intent and contact priorities as search-run state", () => {
    renderView();
    expect(screen.getByText("Search intent only. Not treated as a company fact.")).toBeTruthy();
    expect(screen.getByText("Optional. Saved with this search for later contact enrichment.")).toBeTruthy();
    expect(screen.queryByText(/Recorded on the candidate/)).toBeNull();
  });
});
