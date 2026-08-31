import { describe, expect, it } from "vitest";
import {
  DRAIN_ACTIVE_MS,
  DRAIN_HIDDEN_ACTIVE_MS,
  DRAIN_HIDDEN_IDLE_MS,
  DRAIN_IDLE_MS,
  nextDrainDelayMs,
} from "./freeEnrichmentDrainSchedule";

describe("CFG1 free-enrichment drain idle cadence", () => {
  it("polls quickly when a drain claimed work", () => {
    expect(nextDrainDelayMs(1, false)).toBe(DRAIN_ACTIVE_MS);
    expect(nextDrainDelayMs(2, true)).toBe(DRAIN_HIDDEN_ACTIVE_MS);
  });

  it("enters a calm idle backoff when nothing was claimed", () => {
    expect(nextDrainDelayMs(0, false)).toBe(DRAIN_IDLE_MS);
    expect(nextDrainDelayMs(0, true)).toBe(DRAIN_HIDDEN_IDLE_MS);
    expect(DRAIN_IDLE_MS).toBeGreaterThan(DRAIN_ACTIVE_MS);
    expect(DRAIN_IDLE_MS).toBeGreaterThanOrEqual(15_000);
  });
});
