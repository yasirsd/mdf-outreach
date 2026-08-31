import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SafeSearchRunSnapshot } from "@/lib/buyerFinder/searchRun";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
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
}) {
  return render(
    <BuyerFinderView
      initialQueue={[]}
      initialSummary={EMPTY_SUMMARY}
      queueLimit={100}
      hunterDiscovery={over?.hunterDiscovery ?? "ready"}
      initialActiveRun={over?.initialActiveRun ?? null}
    />,
  );
}

describe("BuyerFinderView search-run UX", () => {
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
