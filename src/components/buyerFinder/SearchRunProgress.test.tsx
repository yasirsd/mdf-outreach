import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SearchRunProgressSurface } from "./SearchRunProgress";
import type { SafeSearchRunSnapshot } from "@/lib/buyerFinder/searchRun";

afterEach(() => cleanup());

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
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    ...over,
  };
}

const noop = () => undefined;

describe("SearchRunProgressSurface", () => {
  it("renders the live progress surface for an active run", () => {
    render(
      <SearchRunProgressSurface
        run={snap()}
        now={new Date("2026-08-28T00:00:01.000Z")}
        onViewCandidates={noop}
        onFindMore={noop}
        onStartNew={noop}
      />,
    );
    expect(screen.getByText(/Finding companies in Thailand/)).toBeTruthy();
    expect(screen.getByText(/Guntur Dry Red Chilli/)).toBeTruthy();
    expect(screen.getByText(/Searching Hunter Discover/)).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows N / total and a determinate bar while processing", () => {
    render(
      <SearchRunProgressSurface
        run={snap({
          stage: "processing_candidates",
          discoveredCount: 87,
          usableCount: 82,
          processedCount: 32,
        })}
        now={new Date("2026-08-28T00:00:01.000Z")}
        onViewCandidates={noop}
        onFindMore={noop}
        onStartNew={noop}
      />,
    );
    expect(screen.getAllByText("32 / 82 checked").length).toBeGreaterThan(0);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("32");
    expect(bar.getAttribute("aria-valuemax")).toBe("82");
  });

  it("does not invent a percentage during discovering", () => {
    render(
      <SearchRunProgressSurface
        run={snap({ stage: "discovering" })}
        now={new Date("2026-08-28T00:00:01.000Z")}
        onViewCandidates={noop}
        onFindMore={noop}
        onStartNew={noop}
      />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.body.textContent).not.toMatch(/%/);
  });

  it("shows the completion card with truthful counters", () => {
    render(
      <SearchRunProgressSurface
        run={snap({
          status: "completed",
          stage: "complete",
          discoveredCount: 10,
          usableCount: 8,
          createdCount: 5,
          enrichedExistingCount: 2,
          duplicateCount: 1,
          productMatchesAdded: 7,
          failureCount: 0,
        })}
        onViewCandidates={noop}
        onFindMore={noop}
        onStartNew={noop}
      />,
    );
    expect(screen.getByText("Search complete")).toBeTruthy();
    expect(screen.getByText("New candidates")).toBeTruthy();
    expect(screen.queryByText(/Strong candidates/i)).toBeNull();
    expect(screen.queryByText(/Qualified/i)).toBeNull();
    expect(screen.getByRole("button", { name: "View candidates" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find more companies" })).toBeTruthy();
  });

  it("shows partial copy and that saved results are safe", () => {
    render(
      <SearchRunProgressSurface
        run={snap({
          status: "partial",
          stage: "complete",
          createdCount: 3,
          enrichedExistingCount: 1,
          failureCount: 2,
        })}
        onViewCandidates={noop}
        onFindMore={noop}
        onStartNew={noop}
      />,
    );
    expect(screen.getByText("Search partially completed")).toBeTruthy();
    expect(screen.getByText(/Saved results are safe/)).toBeTruthy();
  });

  it("translates a failed provider outcome into a safe message", () => {
    render(
      <SearchRunProgressSurface
        run={snap({
          status: "failed",
          stage: "complete",
          providerStatus: "rate_limited",
          errorMessage: "Hunter is temporarily rate limited.",
        })}
        onViewCandidates={noop}
        onFindMore={noop}
        onStartNew={noop}
      />,
    );
    expect(screen.getByText("Search could not complete")).toBeTruthy();
    expect(screen.getByText(/temporarily rate limited/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/PostgREST|repository|ingestion/i);
  });

  it("View details is collapsed until opened", () => {
    render(
      <SearchRunProgressSurface
        run={snap()}
        now={new Date("2026-08-28T00:00:01.000Z")}
        onViewCandidates={noop}
        onFindMore={noop}
        onStartNew={noop}
      />,
    );
    expect(screen.queryByText("Capability")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /View details/i }));
    expect(screen.getByText("Capability")).toBeTruthy();
    expect(screen.getByText("Company discovery")).toBeTruthy();
    expect(screen.getByText("Credits used")).toBeTruthy();
  });
});
