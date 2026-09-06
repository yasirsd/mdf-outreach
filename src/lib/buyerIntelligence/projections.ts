import type {
  BuyerTradeObservation,
  ProductProjection,
  SupplierProjection,
} from "./types";

function verifiedShipment(row: BuyerTradeObservation): boolean {
  return row.evidenceLevel === 1 && row.granularity === "shipment";
}

function orderedUnique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort();
}

function dateBounds(rows: BuyerTradeObservation[]) {
  const dates = rows.map((row) => row.tradeDate).filter((value): value is string => Boolean(value)).sort();
  return { firstObserved: dates[0], lastObserved: dates[dates.length - 1] };
}

export function projectSuppliers(observations: BuyerTradeObservation[]): SupplierProjection[] {
  const groups = new Map<string, BuyerTradeObservation[]>();
  for (const row of observations) {
    const name = row.supplierNameNormalized?.trim() || row.supplierNameRaw?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, rows]) => {
      const first = rows[0];
      const name = first.supplierNameNormalized?.trim() || first.supplierNameRaw?.trim() || key;
      const productOverlap = orderedUnique(
        rows.flatMap((row) => [row.mdfProductId, row.normalizedProductCategory]),
      );
      return {
        key,
        name,
        countryCode: rows.find((row) => row.supplierCountryCode)?.supplierCountryCode,
        ...dateBounds(rows),
        verifiedShipmentCount: rows.filter(verifiedShipment).length,
        productOverlap,
      };
    })
    .sort((a, b) => b.verifiedShipmentCount - a.verifiedShipmentCount || a.name.localeCompare(b.name));
}

function productKey(row: BuyerTradeObservation): string | undefined {
  if (row.mdfProductId) return `mdf:${row.mdfProductId}`;
  if (row.normalizedProductCategory) return `category:${row.normalizedProductCategory.toLowerCase()}`;
  if (row.hsCodeRaw) return `hs:${row.hsCodeRaw}`;
  if (row.productDescriptionRaw) return `raw:${row.productDescriptionRaw.toLowerCase()}`;
  return undefined;
}

export function projectProducts(observations: BuyerTradeObservation[]): ProductProjection[] {
  const groups = new Map<string, BuyerTradeObservation[]>();
  for (const row of observations) {
    const key = productKey(row);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, rows]) => ({
      key,
      rawDescriptions: orderedUnique(rows.map((row) => row.productDescriptionRaw)),
      normalizedCategories: orderedUnique(rows.map((row) => row.normalizedProductCategory)),
      mdfProductIds: orderedUnique(rows.map((row) => row.mdfProductId)),
      hsCodes: orderedUnique(rows.map((row) => row.hsCodeRaw)),
      ...dateBounds(rows),
      verifiedShipmentCount: rows.filter(verifiedShipment).length,
    }))
    .sort((a, b) => b.verifiedShipmentCount - a.verifiedShipmentCount || a.key.localeCompare(b.key));
}
