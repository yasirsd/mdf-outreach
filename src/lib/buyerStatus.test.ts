import { describe, it, expect } from "vitest";
import {
  buyerPatchAfterSuccessfulSend,
  nextStatusAfterSuccessfulSend,
} from "./buyerStatus";
import type { Buyer, BuyerStatus } from "@/lib/types";

const AT = "2026-08-26T10:00:00Z";

describe("nextStatusAfterSuccessfulSend", () => {
  it.each<[BuyerStatus, BuyerStatus | null]>([
    ["new", "contacted"],
    ["qualified", "contacted"],
    ["ready", "contacted"],
    ["contacted", null], // idempotent — do not re-set
    ["replied", null], // never downgrade
    ["interested", null],
    ["quotation-sent", null],
    ["negotiating", null],
    ["converted", null],
    ["not-interested", null],
  ])("current=%s → %s", (current, expected) => {
    expect(nextStatusAfterSuccessfulSend(current)).toBe(expected);
  });
});

describe("buyerPatchAfterSuccessfulSend", () => {
  it("sets last_contacted_at and promotes new → contacted", () => {
    const patch = buyerPatchAfterSuccessfulSend({ status: "new" } as Buyer, AT);
    expect(patch).toEqual({ status: "contacted", lastContactedAt: AT });
  });

  it("sets last_contacted_at ONLY for an advanced buyer (never overwrites status)", () => {
    const patch = buyerPatchAfterSuccessfulSend({ status: "negotiating" } as Buyer, AT);
    expect(patch).toEqual({ lastContactedAt: AT });
    expect(patch && "status" in patch).toBe(false);
  });

  it("does NOT touch status for an already-contacted buyer, but still bumps last_contacted_at", () => {
    const patch = buyerPatchAfterSuccessfulSend({ status: "contacted" } as Buyer, AT);
    expect(patch).toEqual({ lastContactedAt: AT });
  });

  it("does NOT downgrade a converted buyer", () => {
    const patch = buyerPatchAfterSuccessfulSend({ status: "converted" } as Buyer, AT);
    expect(patch?.status).toBeUndefined();
  });

  it("does NOT overwrite a not-interested buyer", () => {
    const patch = buyerPatchAfterSuccessfulSend({ status: "not-interested" } as Buyer, AT);
    expect(patch?.status).toBeUndefined();
  });
});
