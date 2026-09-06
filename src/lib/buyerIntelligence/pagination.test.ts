import { describe, expect, it } from "vitest";
import {
  clampTradePageLimit,
  cursorForObservation,
  decodeTradeCursor,
  encodeTradeCursor,
} from "./pagination";
import { buyerTradeObservationFixtures } from "./testUtils/fixtures";

describe("BI1 keyset pagination contract", () => {
  it("round-trips only database ordering keys", () => {
    const cursor = cursorForObservation(buyerTradeObservationFixtures[0]);
    expect(cursor).toBe("bi1|2026-07-10|50000000-0000-4000-8000-000000000001");
    expect(decodeTradeCursor(cursor)).toEqual({
      tradeDate: "2026-07-10",
      id: "50000000-0000-4000-8000-000000000001",
    });
  });

  it("supports null trade dates without inventing one", () => {
    const encoded = encodeTradeCursor({ id: buyerTradeObservationFixtures[2].id });
    expect(decodeTradeCursor(encoded)).toEqual({
      tradeDate: undefined,
      id: buyerTradeObservationFixtures[2].id,
    });
  });

  it("rejects provider/invalid cursors and clamps bounded page sizes", () => {
    expect(() => decodeTradeCursor("provider-next-page-token")).toThrow(/Invalid trade cursor/);
    expect(() => encodeTradeCursor({ id: "not-a-uuid" })).toThrow(/cursor id/);
    expect(clampTradePageLimit(undefined)).toBe(25);
    expect(clampTradePageLimit(0)).toBe(1);
    expect(clampTradePageLimit(1000)).toBe(100);
  });
});
