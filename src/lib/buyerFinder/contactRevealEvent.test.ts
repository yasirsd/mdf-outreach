import { describe, expect, it } from "vitest";
import {
  isActiveRevealStatus,
  isTerminalRevealStatus,
  CONTACT_REVEAL_TERMINAL_STATUSES,
  CONTACT_REVEAL_UNRESOLVED_STATUSES,
} from "./contactRevealEvent";

describe("contact reveal event lock states", () => {
  it("treats pending, processing, and reconciliation_required as unresolved paid locks", () => {
    expect([...CONTACT_REVEAL_UNRESOLVED_STATUSES]).toEqual([
      "pending",
      "processing",
      "reconciliation_required",
    ]);
    expect(isActiveRevealStatus("pending")).toBe(true);
    expect(isActiveRevealStatus("processing")).toBe(true);
    expect(isActiveRevealStatus("reconciliation_required")).toBe(true);
  });

  it("treats succeeded and failed as terminal historical states", () => {
    expect([...CONTACT_REVEAL_TERMINAL_STATUSES]).toEqual(["succeeded", "failed"]);
    expect(isTerminalRevealStatus("succeeded")).toBe(true);
    expect(isTerminalRevealStatus("failed")).toBe(true);
    expect(isActiveRevealStatus("succeeded")).toBe(false);
    expect(isActiveRevealStatus("failed")).toBe(false);
    expect(isTerminalRevealStatus("reconciliation_required")).toBe(false);
  });
});
