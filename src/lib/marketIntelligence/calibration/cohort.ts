/**
 * MI1E — calibration cohort.
 *
 * The 18 canonical alpha-2 markets we use to derive Market Fit component
 * normalization rules for the guntur-dry-red-chilli / HS17 090421 trade
 * proxy. Every entry is a MDF-catalogue alpha-2; the provider adapter is
 * responsible for translating each to its BotMarket alpha-3 wire id at
 * the edge. BACI availability is verified against the live member list
 * BEFORE any fetch is issued — a country whose alpha-3 is not present
 * in the current importer-member roster is reported as `unavailable`
 * rather than silently substituted.
 *
 * No provider call, no DB write, no side effects. Pure data + pure
 * lookups only.
 */

import { alpha2ToAlpha3 } from "../country";
import { toBaciCountryId } from "../providers/baci/country";
import type { CountryAlpha2 } from "../types";

export type CalibrationCohortRole = "focus" | "regional" | "comparator";

export interface CalibrationCohortEntry {
  countryAlpha2: CountryAlpha2;
  displayName: string;
  role: CalibrationCohortRole;
  /** BotMarket wire id (lowercase alpha-3). Never null — used at adapter edge only. */
  baciImporterId: string;
}

/**
 * MDF-relevant importers for chilli calibration. Ordering is intentional:
 * regional GCC + South-East Asia buyers first, then broader comparators
 * so distribution reports read as MDF's likely target markets first.
 */
const COHORT: ReadonlyArray<Omit<CalibrationCohortEntry, "baciImporterId">> = Object.freeze([
  { countryAlpha2: "MY", displayName: "Malaysia",             role: "focus" },
  { countryAlpha2: "AE", displayName: "United Arab Emirates", role: "regional" },
  { countryAlpha2: "SA", displayName: "Saudi Arabia",         role: "regional" },
  { countryAlpha2: "QA", displayName: "Qatar",                role: "regional" },
  { countryAlpha2: "OM", displayName: "Oman",                 role: "regional" },
  { countryAlpha2: "KW", displayName: "Kuwait",               role: "regional" },
  { countryAlpha2: "SG", displayName: "Singapore",            role: "regional" },
  { countryAlpha2: "TH", displayName: "Thailand",             role: "regional" },
  { countryAlpha2: "VN", displayName: "Vietnam",              role: "regional" },
  { countryAlpha2: "LK", displayName: "Sri Lanka",            role: "regional" },
  { countryAlpha2: "KR", displayName: "South Korea",          role: "comparator" },
  { countryAlpha2: "JP", displayName: "Japan",                role: "comparator" },
  { countryAlpha2: "GB", displayName: "United Kingdom",       role: "comparator" },
  { countryAlpha2: "DE", displayName: "Germany",              role: "comparator" },
  { countryAlpha2: "NL", displayName: "Netherlands",          role: "comparator" },
  { countryAlpha2: "US", displayName: "United States",        role: "comparator" },
  { countryAlpha2: "CA", displayName: "Canada",               role: "comparator" },
  { countryAlpha2: "AU", displayName: "Australia",            role: "comparator" },
]);

const RESOLVED: ReadonlyArray<CalibrationCohortEntry> = Object.freeze(
  COHORT.map((entry) => {
    const alpha3 = alpha2ToAlpha3(entry.countryAlpha2);
    if (!alpha3) {
      // Fail-closed at module load so a mis-typed alpha-2 is caught before
      // any calibration call runs. Every catalogue country used here IS
      // present in iso-3166.
      throw new Error(
        `[MI1E cohort] unknown alpha-2 in calibration cohort: ${entry.countryAlpha2}`,
      );
    }
    return {
      ...entry,
      baciImporterId: toBaciCountryId(entry.countryAlpha2),
    };
  }),
);

export function calibrationCohort(): ReadonlyArray<CalibrationCohortEntry> {
  return RESOLVED;
}

/**
 * Split the cohort against a provider-member roster (the actual
 * `/api/datasets/baci-hs17/members/importer_id` response). Countries
 * whose alpha-3 is not present in the roster are reported as
 * `unavailable`; the fetch loop MUST skip them rather than substitute.
 */
export interface CohortAvailabilityReport {
  available: ReadonlyArray<CalibrationCohortEntry>;
  unavailable: ReadonlyArray<CalibrationCohortEntry>;
  /** Cardinality guard: available + unavailable must equal the cohort. */
  totals: { cohort: number; available: number; unavailable: number };
}

export function splitCohortByProviderAvailability(
  providerImporterMembers: ReadonlyArray<string>,
): CohortAvailabilityReport {
  const roster = new Set(providerImporterMembers.map((id) => id.toLowerCase()));
  const available: CalibrationCohortEntry[] = [];
  const unavailable: CalibrationCohortEntry[] = [];
  for (const entry of RESOLVED) {
    if (roster.has(entry.baciImporterId)) available.push(entry);
    else unavailable.push(entry);
  }
  return {
    available,
    unavailable,
    totals: {
      cohort: RESOLVED.length,
      available: available.length,
      unavailable: unavailable.length,
    },
  };
}
