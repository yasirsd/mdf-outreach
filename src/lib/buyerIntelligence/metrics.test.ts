import { describe, expect, it } from "vitest";
import { basicSummaryMetricValues, calculateBasicTradeSummary } from "./metrics";
import {
  buyerTradeObservationFixtures,
  controlledTradeSummary,
} from "./testUtils/fixtures";

describe("BI1 deterministic trade metrics", () => {
  it("counts only Level 1 shipment rows as verified shipments", () => {
    expect(controlledTradeSummary.tradeObservationCount).toBe(3);
    expect(controlledTradeSummary.shipmentCount).toBe(2);
    expect(controlledTradeSummary.lastObservedTrade).toBe("2026-07-10");
    expect(controlledTradeSummary.originCountryDistribution).toEqual([
      { countryCode: "IN", count: 1 },
      { countryCode: "VN", count: 1 },
    ]);
    expect(controlledTradeSummary.supplierRanking).toHaveLength(2);
  });

  it("derives India sourcing from actual observation origins, never candidate country", () => {
    expect(controlledTradeSummary.indiaShipmentCount).toBe(1);
    expect(controlledTradeSummary.indiaShipmentShare).toBe(0.5);
    expect(controlledTradeSummary.lastObservedIndiaTrade).toBe("2026-07-10");
  });

  it("keeps an unknown origin missing and excludes it from the share denominator", () => {
    const withoutOrigin = {
      ...buyerTradeObservationFixtures[0],
      id: "50000000-0000-4000-8000-000000000099",
      originCountryCode: undefined,
    };
    const summary = calculateBasicTradeSummary([withoutOrigin]);
    expect(summary.indiaShipmentCount).toBe(0);
    expect(summary.indiaShipmentShare).toBeUndefined();
    expect(summary.originCountryDistribution).toEqual([]);
  });

  it("uses an inclusive 365-calendar-day recency window", () => {
    const asOf = new Date("2026-09-02T00:00:00Z");
    const atBoundary = { ...buyerTradeObservationFixtures[0], id: "50000000-0000-4000-8000-000000000097", tradeDate: "2025-09-03" };
    const beforeBoundary = { ...buyerTradeObservationFixtures[0], id: "50000000-0000-4000-8000-000000000098", tradeDate: "2025-09-02" };
    expect(calculateBasicTradeSummary([atBoundary, beforeBoundary], { asOf }).activityLast12Months).toBe(1);
  });

  it("emits normalized typed metric rows with controlled keys and units", () => {
    const values = basicSummaryMetricValues(controlledTradeSummary, buyerTradeObservationFixtures);
    expect(values.find((row) => row.metricKey === "shipment_count")).toEqual({
      metricKey: "shipment_count",
      value: { type: "number", value: 2 },
      unit: "count",
      supportingObservationCount: 2,
    });
    expect(values.find((row) => row.metricKey === "india_observation_share")?.value).toEqual({
      type: "number",
      value: 0.5,
    });
  });

  it("counts a dated verified transaction as support for last observed trade", () => {
    const transaction = {
      ...buyerTradeObservationFixtures[0],
      id: "50000000-0000-4000-8000-000000000096",
      granularity: "transaction" as const,
    };
    const summary = calculateBasicTradeSummary([transaction]);
    const values = basicSummaryMetricValues(summary, [transaction]);
    expect(summary.shipmentCount).toBe(0);
    expect(summary.lastObservedTrade).toBe("2026-07-10");
    expect(values.find((row) => row.metricKey === "last_observed_trade")?.supportingObservationCount).toBe(1);
  });

  it("defines india_observation_share as verified shipment share, excluding transactions", () => {
    const indiaTransaction = {
      ...buyerTradeObservationFixtures[0],
      id: "50000000-0000-4000-8000-000000000095",
      granularity: "transaction" as const,
    };
    const vietnamShipment = buyerTradeObservationFixtures[1];
    const summary = calculateBasicTradeSummary([indiaTransaction, vietnamShipment]);
    const values = basicSummaryMetricValues(summary, [indiaTransaction, vietnamShipment]);
    expect(summary.indiaObservationCount).toBe(1);
    expect(summary.indiaShipmentCount).toBe(0);
    expect(summary.indiaShipmentShare).toBe(0);
    expect(values.find((row) => row.metricKey === "india_observation_share")?.supportingObservationCount).toBe(1);
  });
});
