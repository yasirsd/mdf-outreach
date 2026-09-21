import type {
  MarketReadRepositoryMaterialObservation,
} from "../../marketReadRepository";
import type { MarketTradeObservation } from "../../types";
import { fromBaciCountryId } from "./country";
import type { BaciWireRow } from "./normalize";

export const MATERIAL_FIELDS = [
  "trade_value_usd",
  "quantity",
  "quantity_unit",
  "net_weight_kg",
  "source_period",
  "source_url",
  "safe_source_ref",
] as const;

export type MaterialField = typeof MATERIAL_FIELDS[number];
export type MaterialValue = number | string | null;

export interface ObservationIdentityDiagnostic {
  provider_id: string;
  dataset_id: string;
  reporter_country: string;
  partner_key: string;
  trade_flow: string;
  hs_revision: string;
  hs_code: string;
  frequency: string;
  period: string;
}

export type DifferenceOrigin =
  | "raw_provider_value_differs"
  | "normalization_or_derived_value_differs";

export interface MaterialComparisonExample {
  kind: "material_mismatch" | "provider_only" | "persisted_only";
  identity: ObservationIdentityDiagnostic;
  differingFields: MaterialField[];
  differenceOrigins?: Partial<Record<MaterialField, DifferenceOrigin>>;
  persisted?: Partial<Record<MaterialField, MaterialValue>>;
  provider?: Partial<Record<MaterialField, MaterialValue>>;
  rawProvider?: Partial<Record<MaterialField, MaterialValue | "not_provided">>;
}

export interface MaterialComparisonSummary {
  providerRows: number;
  persistedRows: number;
  exactMatches: number;
  mismatches: number;
  providerOnly: number;
  persistedOnly: number;
  mismatchFieldCounts: Record<MaterialField, number>;
  mismatchOriginCounts: Record<DifferenceOrigin, number>;
  examples: MaterialComparisonExample[];
}

interface ComparableRow {
  identity: ObservationIdentityDiagnostic;
  material: Record<MaterialField, MaterialValue>;
}

/** PostgreSQL numeric equality semantics for the numeric values exposed here. */
function materialValuesEqual(
  field: MaterialField,
  left: MaterialValue,
  right: MaterialValue,
): boolean {
  if (left === null || right === null) return left === right;
  if (field === "trade_value_usd" || field === "quantity" || field === "net_weight_kg") {
    return typeof left === "number" && typeof right === "number" && left === right;
  }
  return left === right;
}

function identityKey(identity: ObservationIdentityDiagnostic): string {
  return [
    identity.provider_id,
    identity.dataset_id,
    identity.reporter_country,
    identity.partner_key,
    identity.trade_flow,
    identity.hs_revision,
    identity.hs_code,
    identity.frequency,
    identity.period,
  ].join("\u001f");
}

function providerComparable(row: MarketTradeObservation): ComparableRow {
  return {
    identity: {
      provider_id: row.providerId,
      dataset_id: row.datasetId,
      reporter_country: row.reporterCountry,
      partner_key: row.partnerCountry ?? "__WORLD__",
      trade_flow: row.tradeFlow,
      hs_revision: row.hsRevision,
      hs_code: row.hsCode,
      frequency: row.frequency,
      period: row.period,
    },
    material: {
      trade_value_usd: row.tradeValueUsd ?? null,
      quantity: row.quantity ?? null,
      quantity_unit: row.quantityUnit ?? null,
      net_weight_kg: row.netWeightKg ?? null,
      source_period: row.sourcePeriod ?? null,
      source_url: row.sourceUrl ?? null,
      safe_source_ref: row.safeReference ?? null,
    },
  };
}

function persistedComparable(row: MarketReadRepositoryMaterialObservation): ComparableRow {
  return {
    identity: {
      provider_id: row.providerId,
      dataset_id: row.datasetId,
      reporter_country: row.reporterCountry,
      partner_key: row.partnerCountry ?? "__WORLD__",
      trade_flow: row.tradeFlow,
      hs_revision: row.hsRevision,
      hs_code: row.hsCode,
      frequency: row.frequency,
      period: row.period,
    },
    material: {
      trade_value_usd: row.tradeValueUsd,
      quantity: row.quantity,
      quantity_unit: row.quantityUnit,
      net_weight_kg: row.netWeightKg,
      source_period: row.sourcePeriod,
      source_url: row.sourceUrl,
      safe_source_ref: row.safeSourceRef,
    },
  };
}

function rawIdentity(row: BaciWireRow): ObservationIdentityDiagnostic {
  return {
    provider_id: "baci_oec",
    dataset_id: "baci-hs17",
    reporter_country: fromBaciCountryId(row.importer_id),
    partner_key: fromBaciCountryId(row.exporter_id),
    trade_flow: "import",
    hs_revision: "HS17",
    hs_code: row.hs_code,
    frequency: "annual",
    period: String(row.year),
  };
}

function rawEvidence(row: BaciWireRow | undefined): Record<MaterialField, MaterialValue | "not_provided"> {
  return {
    trade_value_usd: row?.value ?? null,
    quantity: row?.quantity ?? null,
    quantity_unit: row ? (row.unit_abbrevation ?? row.unit_name) : null,
    net_weight_kg: "not_provided",
    source_period: row ? String(row.year) : null,
    source_url: "not_provided",
    safe_source_ref: "not_provided",
  };
}

function differenceOrigin(
  field: MaterialField,
  raw: BaciWireRow | undefined,
  persistedValue: MaterialValue,
): DifferenceOrigin {
  if (field === "trade_value_usd" && raw &&
      !materialValuesEqual(field, raw.value, persistedValue)) {
    return "raw_provider_value_differs";
  }
  if (field === "quantity" && raw &&
      !materialValuesEqual(field, raw.quantity, persistedValue)) {
    return "raw_provider_value_differs";
  }
  return "normalization_or_derived_value_differs";
}

function indexComparable(rows: readonly ComparableRow[]): Map<string, ComparableRow> {
  const result = new Map<string, ComparableRow>();
  for (const row of rows) {
    const key = identityKey(row.identity);
    if (result.has(key)) throw new Error("Duplicate observation identity in diagnostic comparison");
    result.set(key, row);
  }
  return result;
}

/** Pure, side-effect-free mirror of migration 0022's observation comparison. */
export function compareBaciObservationMaterial(
  normalizedProviderRows: readonly MarketTradeObservation[],
  persistedRows: readonly MarketReadRepositoryMaterialObservation[],
  rawProviderRows: readonly BaciWireRow[],
  exampleLimit = 10,
): MaterialComparisonSummary {
  const provider = indexComparable(normalizedProviderRows.map(providerComparable));
  const persisted = indexComparable(persistedRows.map(persistedComparable));
  const raw = new Map(rawProviderRows.map((row) => [identityKey(rawIdentity(row)), row]));
  const mismatchFieldCounts = Object.fromEntries(
    MATERIAL_FIELDS.map((field) => [field, 0]),
  ) as Record<MaterialField, number>;
  const examples: MaterialComparisonExample[] = [];
  const mismatchOriginCounts: Record<DifferenceOrigin, number> = {
    raw_provider_value_differs: 0,
    normalization_or_derived_value_differs: 0,
  };
  let exactMatches = 0;
  let mismatches = 0;
  let providerOnly = 0;
  let persistedOnly = 0;

  const keys = [...new Set([...provider.keys(), ...persisted.keys()])].sort();
  for (const key of keys) {
    const providerRow = provider.get(key);
    const persistedRow = persisted.get(key);
    if (!providerRow) {
      persistedOnly += 1;
      if (examples.length < exampleLimit) {
        examples.push({
          kind: "persisted_only",
          identity: persistedRow!.identity,
          differingFields: [],
          persisted: persistedRow!.material,
        });
      }
      continue;
    }
    if (!persistedRow) {
      providerOnly += 1;
      if (examples.length < exampleLimit) {
        examples.push({
          kind: "provider_only",
          identity: providerRow.identity,
          differingFields: [],
          provider: providerRow.material,
          rawProvider: rawEvidence(raw.get(key)),
        });
      }
      continue;
    }

    const differingFields = MATERIAL_FIELDS.filter((field) =>
      !materialValuesEqual(field, persistedRow.material[field], providerRow.material[field])
    );
    if (differingFields.length === 0) {
      exactMatches += 1;
      continue;
    }
    mismatches += 1;
    const rawRow = raw.get(key);
    const origins: Partial<Record<MaterialField, DifferenceOrigin>> = {};
    for (const field of differingFields) {
      mismatchFieldCounts[field] += 1;
      const origin = differenceOrigin(field, rawRow, persistedRow.material[field]);
      origins[field] = origin;
      mismatchOriginCounts[origin] += 1;
    }
    if (examples.length < exampleLimit) {
      const persistedMaterial: Partial<Record<MaterialField, MaterialValue>> = {};
      const providerMaterial: Partial<Record<MaterialField, MaterialValue>> = {};
      for (const field of differingFields) {
        persistedMaterial[field] = persistedRow.material[field];
        providerMaterial[field] = providerRow.material[field];
      }
      examples.push({
        kind: "material_mismatch",
        identity: providerRow.identity,
        differingFields,
        differenceOrigins: origins,
        persisted: persistedMaterial,
        provider: providerMaterial,
        rawProvider: rawEvidence(rawRow),
      });
    }
  }

  return {
    providerRows: normalizedProviderRows.length,
    persistedRows: persistedRows.length,
    exactMatches,
    mismatches,
    providerOnly,
    persistedOnly,
    mismatchFieldCounts,
    mismatchOriginCounts,
    examples,
  };
}
