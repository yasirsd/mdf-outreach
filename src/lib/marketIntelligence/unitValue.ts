/**
 * MI0 — derived unit value with strict unit safety.
 *
 * Every UI label MUST read "Derived import unit value" (never
 * "market price"). The helper refuses to compute when units are
 * missing or incompatible so the UI never mixes USD/tonne with
 * USD/kg silently.
 */

import type { MarketQuantityUnit } from "./types";

export interface UnitValueInput {
  tradeValueUsd: number | null | undefined;
  quantity: number | null | undefined;
  quantityUnit: MarketQuantityUnit | null | undefined;
}

export interface DerivedUnitValue {
  value: number;
  unit: "USD/kg" | "USD/tonne" | "USD/unit" | "USD/litre" | "USD/cubic_metre";
  label: "Derived import unit value";
}

export type UnitValueFailure =
  | "missing_value"
  | "missing_quantity"
  | "unsupported_unit"
  | "non_positive";

export type UnitValueResult =
  | { ok: true; result: DerivedUnitValue }
  | { ok: false; reason: UnitValueFailure };

const UNIT_LABELS: Record<Exclude<MarketQuantityUnit, "other">, DerivedUnitValue["unit"]> = {
  kg: "USD/kg",
  tonne: "USD/tonne",
  unit: "USD/unit",
  litre: "USD/litre",
  cubic_metre: "USD/cubic_metre",
};

export function derivedUnitValue(input: UnitValueInput): UnitValueResult {
  const value = input.tradeValueUsd;
  const qty = input.quantity;
  const unit = input.quantityUnit;
  if (!Number.isFinite(value ?? NaN)) return { ok: false, reason: "missing_value" };
  if (!Number.isFinite(qty ?? NaN)) return { ok: false, reason: "missing_quantity" };
  if (!unit || unit === "other") return { ok: false, reason: "unsupported_unit" };
  if ((value as number) <= 0 || (qty as number) <= 0) return { ok: false, reason: "non_positive" };
  const label = UNIT_LABELS[unit as Exclude<MarketQuantityUnit, "other">];
  if (!label) return { ok: false, reason: "unsupported_unit" };
  return {
    ok: true,
    result: {
      value: (value as number) / (qty as number),
      unit: label,
      label: "Derived import unit value",
    },
  };
}
