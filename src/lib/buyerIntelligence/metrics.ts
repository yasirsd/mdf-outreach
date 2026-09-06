import type {
  BasicTradeSummary,
  BuyerTradeObservation,
  TradeMetricKey,
  TradeMetricUnit,
  TradeMetricValue,
} from "./types";

export const BASIC_METRICS_CALCULATION_VERSION = "bi2-metrics-v1";

function isVerifiedTrade(row: BuyerTradeObservation): boolean {
  return (
    row.evidenceLevel === 1 &&
    (row.granularity === "shipment" || row.granularity === "transaction")
  );
}

function maxDate(rows: BuyerTradeObservation[]): string | undefined {
  return rows
    .map((row) => row.tradeDate)
    .filter((date): date is string => Boolean(date))
    .sort((a, b) => b.localeCompare(a))[0];
}

export function calculateBasicTradeSummary(
  observations: BuyerTradeObservation[],
  options: { asOf?: Date } = {},
): BasicTradeSummary {
  const asOf = options.asOf ?? new Date();
  const trailingStart = new Date(asOf);
  // Inclusive date window: as-of day plus the preceding 364 calendar days.
  trailingStart.setUTCDate(trailingStart.getUTCDate() - 364);
  const trailingStartDate = trailingStart.toISOString().slice(0, 10);
  const asOfDate = asOf.toISOString().slice(0, 10);
  const verified = observations.filter(isVerifiedTrade);
  const shipments = verified.filter((row) => row.granularity === "shipment");
  const india = verified.filter((row) => row.originCountryCode === "IN");
  const indiaShipments = shipments.filter((row) => row.originCountryCode === "IN");
  const shipmentsWithKnownOrigin = shipments.filter((row) => row.originCountryCode);

  const origins = new Map<string, number>();
  for (const row of shipmentsWithKnownOrigin) {
    const country = row.originCountryCode as string;
    origins.set(country, (origins.get(country) ?? 0) + 1);
  }

  const suppliers = new Map<string, { supplier: string; countryCode?: string; count: number }>();
  for (const row of shipments) {
    const name = row.supplierNameNormalized?.trim() || row.supplierNameRaw?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const current = suppliers.get(key);
    suppliers.set(key, {
      supplier: current?.supplier ?? name,
      countryCode: current?.countryCode ?? row.supplierCountryCode,
      count: (current?.count ?? 0) + 1,
    });
  }

  return {
    lastObservedTrade: maxDate(verified),
    tradeObservationCount: observations.length,
    shipmentCount: shipments.length,
    activityLast12Months: verified.filter(
      (row) =>
        Boolean(row.tradeDate) &&
        (row.tradeDate as string) >= trailingStartDate &&
        (row.tradeDate as string) <= asOfDate,
    ).length,
    indiaObservationCount: india.length,
    indiaShipmentCount: indiaShipments.length,
    indiaShipmentShare:
      shipmentsWithKnownOrigin.length > 0
        ? indiaShipments.length / shipmentsWithKnownOrigin.length
        : undefined,
    lastObservedIndiaTrade: maxDate(india),
    originCountryDistribution: [...origins.entries()]
      .map(([countryCode, count]) => ({ countryCode, count }))
      .sort((a, b) => b.count - a.count || a.countryCode.localeCompare(b.countryCode)),
    supplierCount: suppliers.size,
    supplierRanking: [...suppliers.values()].sort(
      (a, b) => b.count - a.count || a.supplier.localeCompare(b.supplier),
    ),
  };
}

export interface CalculatedMetricValue {
  metricKey: TradeMetricKey;
  value: TradeMetricValue;
  unit: TradeMetricUnit;
  supportingObservationCount: number;
}

export function basicSummaryMetricValues(
  summary: BasicTradeSummary,
  observations: BuyerTradeObservation[],
): CalculatedMetricValue[] {
  const verified = observations.filter(isVerifiedTrade);
  const shipments = verified.filter((row) => row.granularity === "shipment");
  const datedVerified = verified.filter((row) => Boolean(row.tradeDate));
  const datedIndia = verified.filter(
    (row) => row.originCountryCode === "IN" && Boolean(row.tradeDate),
  );
  const knownOriginShipments = shipments.filter((row) => row.originCountryCode);
  const indiaShipments = shipments.filter((row) => row.originCountryCode === "IN");
  const supplierShipments = shipments.filter((row) =>
    Boolean(row.supplierNameNormalized?.trim() || row.supplierNameRaw?.trim()),
  );
  const values: CalculatedMetricValue[] = [
    {
      metricKey: "trade_observation_count",
      value: { type: "number", value: summary.tradeObservationCount },
      unit: "count",
      supportingObservationCount: summary.tradeObservationCount,
    },
    {
      metricKey: "shipment_count",
      value: { type: "number", value: summary.shipmentCount },
      unit: "count",
      supportingObservationCount: summary.shipmentCount,
    },
    {
      metricKey: "activity_last_12_months",
      value: { type: "number", value: summary.activityLast12Months },
      unit: "count",
      supportingObservationCount: summary.activityLast12Months,
    },
    {
      metricKey: "india_observation_count",
      value: { type: "number", value: summary.indiaObservationCount },
      unit: "count",
      supportingObservationCount: summary.indiaObservationCount,
    },
    {
      metricKey: "india_shipment_count",
      value: { type: "number", value: summary.indiaShipmentCount },
      unit: "count",
      supportingObservationCount: indiaShipments.length,
    },
    {
      metricKey: "origin_country_distribution",
      value: { type: "json", value: summary.originCountryDistribution },
      unit: "none",
      supportingObservationCount: knownOriginShipments.length,
    },
    {
      metricKey: "supplier_count",
      value: { type: "number", value: summary.supplierCount },
      unit: "count",
      supportingObservationCount: supplierShipments.length,
    },
    {
      metricKey: "supplier_ranking",
      value: { type: "json", value: summary.supplierRanking },
      unit: "none",
      supportingObservationCount: supplierShipments.length,
    },
  ];

  if (summary.lastObservedTrade) {
    values.push({
      metricKey: "last_observed_trade",
      value: { type: "text", value: summary.lastObservedTrade },
      unit: "date",
      supportingObservationCount: datedVerified.length,
    });
  }
  if (summary.indiaShipmentShare !== undefined) {
    values.push({
      metricKey: "india_observation_share",
      value: { type: "number", value: summary.indiaShipmentShare },
      unit: "ratio",
      supportingObservationCount: knownOriginShipments.length,
    });
  }
  if (summary.lastObservedIndiaTrade) {
    values.push({
      metricKey: "last_observed_india_trade",
      value: { type: "text", value: summary.lastObservedIndiaTrade },
      unit: "date",
      supportingObservationCount: datedIndia.length,
    });
  }
  return values;
}
