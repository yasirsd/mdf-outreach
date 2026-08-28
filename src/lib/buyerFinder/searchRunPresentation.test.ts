import { describe, expect, it } from "vitest";
import { deriveSearchRunView } from "./searchRunPresentation";
import { nextPollDelay, shouldStopPolling, POLL_INTERVAL_MS, POLL_HIDDEN_INTERVAL_MS } from "./useSearchRunPolling";
import type { SafeSearchRunSnapshot } from "./searchRun";
import { STALE_THRESHOLD_MS } from "./searchRun";

function snap(over: Partial<SafeSearchRunSnapshot> = {}): SafeSearchRunSnapshot {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    status: "running",
    stage: "discovering",
    provider: "hunter",
    providerStatus: null,
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

describe("deriveSearchRunView", () => {
  it("shows progress steps without a determinate bar during discovering", () => {
    const view = deriveSearchRunView(snap(), new Date("2026-08-28T00:00:01.000Z"), {
      productDisplayName: "Guntur Dry Red Chilli",
    });
    expect(view.kind).toBe("progress");
    expect(view.title).toMatch(/Thailand/);
    expect(view.subtitle).toBe("Guntur Dry Red Chilli");
    expect(view.bar).toBeNull();
    const discovering = view.steps.find((s) => s.id === "discovering")!;
    expect(discovering.state).toBe("active");
    expect(discovering.label).toMatch(/Hunter/);
    expect(discovering.detail).toMatch(/Free · 0 credits/);
    expect(view.steps.find((s) => s.id === "preparing")?.state).toBe("completed");
  });

  it("shows N / total during processing_candidates with a determinate bar", () => {
    const view = deriveSearchRunView(
      snap({
        stage: "processing_candidates",
        discoveredCount: 87,
        usableCount: 82,
        processedCount: 32,
      }),
      new Date("2026-08-28T00:00:01.000Z"),
    );
    expect(view.bar).toEqual({ processed: 32, total: 82 });
    expect(view.steps.find((s) => s.id === "processing_candidates")?.detail).toBe("32 / 82 checked");
    expect(view.steps.find((s) => s.id === "discovering")?.detail).toMatch(/87 companies discovered/);
  });

  it("marks a stale non-terminal run interrupted", () => {
    const updatedAt = "2026-08-28T00:00:00.000Z";
    const now = new Date(Date.parse(updatedAt) + STALE_THRESHOLD_MS + 1);
    const view = deriveSearchRunView(snap({ updatedAt }), now);
    expect(view.kind).toBe("interrupted");
    expect(view.title).toBe("Search interrupted");
    expect(view.message).toMatch(/stopped updating/);
  });

  it("renders completion and partial kinds from terminal status", () => {
    expect(deriveSearchRunView(snap({ status: "completed", stage: "complete" })).kind).toBe("complete");
    expect(deriveSearchRunView(snap({ status: "partial", stage: "complete" })).kind).toBe("partial");
    expect(deriveSearchRunView(snap({ status: "failed", stage: "complete", errorMessage: "Hunter is temporarily rate limited." })).kind).toBe("failed");
  });

  it("explains validation-only no_result without claiming a crash", () => {
    const view = deriveSearchRunView(
      snap({
        status: "completed",
        stage: "complete",
        providerStatus: "no_result",
        discoveredCount: 12,
        usableCount: 0,
      }),
    );
    expect(view.kind).toBe("complete");
    expect(view.message).toBe("No usable companies were found.");
  });

  it("hints that 20 companies were processed without claiming Hunter is empty", () => {
    const view = deriveSearchRunView(
      snap({
        status: "completed",
        stage: "complete",
        providerStatus: "success",
        discoveredCount: 87,
        usableCount: 20,
        processedCount: 20,
        createdCount: 20,
      }),
    );
    expect(view.message).toBe("20 companies processed in this search.");
    expect(view.message).not.toMatch(/no additional|no more/i);
  });

  it("details are provider-generic and never include raw JSON or keys", () => {
    const view = deriveSearchRunView(snap({ discoveredCount: 87 }));
    const labels = view.details.map((d) => d.label);
    expect(labels).toEqual([
      "Provider",
      "Capability",
      "Cost",
      "Credits used",
      "Companies discovered",
      "Provider status",
    ]);
    expect(JSON.stringify(view.details)).not.toMatch(/api[_-]?key/i);
    expect(JSON.stringify(view.details)).not.toMatch(/hunter\.io/);
  });
});

describe("polling helpers", () => {
  it("uses ~1s when visible and 3–5s when hidden", () => {
    expect(nextPollDelay("visible")).toBe(POLL_INTERVAL_MS);
    expect(POLL_INTERVAL_MS).toBe(1000);
    expect(nextPollDelay("hidden")).toBe(POLL_HIDDEN_INTERVAL_MS);
    expect(POLL_HIDDEN_INTERVAL_MS).toBeGreaterThanOrEqual(3000);
    expect(POLL_HIDDEN_INTERVAL_MS).toBeLessThanOrEqual(5000);
  });

  it("stops at terminal states", () => {
    expect(shouldStopPolling("completed")).toBe(true);
    expect(shouldStopPolling("partial")).toBe(true);
    expect(shouldStopPolling("failed")).toBe(true);
    expect(shouldStopPolling("running")).toBe(false);
    expect(shouldStopPolling("queued")).toBe(false);
  });
});
