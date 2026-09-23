import "server-only";

import type {
  MarketReadRepository,
  MarketReadRepositoryObservation,
  MarketReadRepositorySource,
} from "../marketReadRepository";
import {
  BACI_OEC_DATASET_ID,
  MALAYSIA_CHILLI_HS17_CODE,
  baciQueryFingerprint,
  buildCountryChilliQuery,
} from "../providers/baci/contract";
import type { CountryAlpha2, MarketProviderFetchLedgerEntry } from "../types";

export const MARKET_SCORE_ANALYTICAL_YEARS = Object.freeze([
  2018, 2019, 2020, 2021, 2022, 2023, 2024,
]);

export type PersistedEvidenceRepository = Pick<
  MarketReadRepository,
  | "listRecentLedgerEntriesForFingerprint"
  | "listRecentLedgerEntriesForReporter"
>;

const FRESH_COMPLETE = new Set(["success", "empty"]);

export function verifiedBaciSourceRights(
  source: MarketReadRepositorySource | undefined,
): source is MarketReadRepositorySource {
  return Boolean(
    source &&
    source.providerId === "baci_oec" &&
    source.datasetId === BACI_OEC_DATASET_ID &&
    source.serviceTermsVerified &&
    source.storageAllowed === true &&
    source.redistributionAllowed === false &&
    source.licenceVerifiedAt,
  );
}

function freshComplete(entry: MarketProviderFetchLedgerEntry, now: Date): boolean {
  const freshUntil = Date.parse(entry.freshUntil);
  return FRESH_COMPLETE.has(entry.outcome) &&
    Number.isFinite(freshUntil) && freshUntil > now.getTime();
}

function compatibleIdentity(
  entry: MarketProviderFetchLedgerEntry,
  reporterCountry: CountryAlpha2,
): boolean {
  return entry.providerId === "baci_oec" &&
    entry.datasetId === BACI_OEC_DATASET_ID &&
    entry.reporterCountry === reporterCountry &&
    entry.partnerCountry === null &&
    entry.tradeFlow === "import" &&
    entry.hsRevision === "HS17" &&
    entry.hsCodes.length === 1 &&
    entry.hsCodes[0] === MALAYSIA_CHILLI_HS17_CODE &&
    entry.frequency === "annual";
}

function coverageIncludesAnalyticalYears(entry: MarketProviderFetchLedgerEntry): boolean {
  const start = Number(entry.coverageStart);
  const end = Number(entry.coverageEnd);
  return Number.isInteger(start) && Number.isInteger(end) && start <= 2018 && end >= 2024;
}

function rowsMatchCompatibleLedger(
  rows: readonly MarketReadRepositoryObservation[],
  ledger: MarketProviderFetchLedgerEntry,
  reporterCountry: CountryAlpha2,
): boolean {
  if (rows.length !== ledger.rowsReceived) return false;
  const analyticalYears = new Set(MARKET_SCORE_ANALYTICAL_YEARS);
  const identities = new Set<string>();
  for (const row of rows) {
    const year = Number(row.period);
    const identity = `${row.period}|${row.partnerCountry ?? "__WORLD__"}`;
    if (
      row.providerId !== "baci_oec" ||
      row.datasetId !== BACI_OEC_DATASET_ID ||
      row.reporterCountry !== reporterCountry ||
      row.partnerCountry === null ||
      row.tradeFlow !== "import" ||
      row.hsRevision !== "HS17" ||
      row.hsCode !== MALAYSIA_CHILLI_HS17_CODE ||
      row.frequency !== "annual" ||
      !analyticalYears.has(year) ||
      identities.has(identity)
    ) return false;
    identities.add(identity);
  }
  return ledger.outcome === "empty" ? rows.length === 0 : true;
}

/**
 * Select the ledger row that proves the persisted observation set complete.
 * This function only reads the ledger; it never invokes a provider.
 */
export async function selectAuthoritativePersistedLedger(
  repository: PersistedEvidenceRepository,
  reporterCountry: CountryAlpha2,
  rows: readonly MarketReadRepositoryObservation[],
  now: Date,
): Promise<MarketProviderFetchLedgerEntry | undefined> {
  const exactFingerprint = baciQueryFingerprint(
    buildCountryChilliQuery(reporterCountry, MARKET_SCORE_ANALYTICAL_YEARS),
  );
  const exact = (
    await repository.listRecentLedgerEntriesForFingerprint(
      "baci_oec", BACI_OEC_DATASET_ID, exactFingerprint, 1,
    )
  )[0];
  if (exact && freshComplete(exact, now)) return exact;

  // A fresh failed exact attempt must not be hidden by an older compatible success.
  if (exact && Date.parse(exact.freshUntil) > now.getTime() && !FRESH_COMPLETE.has(exact.outcome)) {
    return undefined;
  }

  const recent = await repository.listRecentLedgerEntriesForReporter(
    "baci_oec", BACI_OEC_DATASET_ID, reporterCountry, 25,
  );
  const latestByFingerprint = new Map<string, MarketProviderFetchLedgerEntry>();
  for (const candidate of recent) {
    if (!latestByFingerprint.has(candidate.queryFingerprint)) {
      latestByFingerprint.set(candidate.queryFingerprint, candidate);
    }
  }
  for (const candidate of latestByFingerprint.values()) {
    if (
      compatibleIdentity(candidate, reporterCountry) &&
      freshComplete(candidate, now) &&
      coverageIncludesAnalyticalYears(candidate) &&
      rowsMatchCompatibleLedger(rows, candidate, reporterCountry)
    ) return candidate;
  }
  return undefined;
}
