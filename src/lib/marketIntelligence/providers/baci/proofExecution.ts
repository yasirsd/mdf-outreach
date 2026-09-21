import "server-only";

import type {
  MarketReadRepository,
  MarketReadRepositoryObservation,
} from "../../marketReadRepository";
import type { MarketIntelligenceWriter } from "../../server/writer";
import {
  BACI_OEC_DATASET_ID,
  buildMalaysiaChilliProofQuery,
  type BaciProofQueryKind,
  type BaciQuerySpec,
} from "./contract";
import { normalizeBaciBilateralRows } from "./normalize";
import { buildBaciDevelopmentReport, type BaciDevelopmentReport } from "./report";
import {
  fetchBaciQueryWithLedger,
  type BaciHttpOptions,
} from "./server";
import {
  buildBaciSourceRegistration,
  buildBaciSourceVerification,
  toMarketTradeObservationBody,
} from "./source";

export interface ControlledBaciProofDependencies extends BaciHttpOptions {
  repository: Pick<
    MarketReadRepository,
    | "getSourceByProviderDataset"
    | "listRecentLedgerEntriesForFingerprint"
    | "listBilateralAnnualObservations"
  >;
  writer: Pick<
    MarketIntelligenceWriter,
    | "ingestSource"
    | "verifySourceRights"
    | "ingestTradeObservation"
    | "recordFetchResult"
  >;
  now?: () => Date;
}

export type ControlledBaciProofResult =
  | {
      outcome: "completed";
      report: BaciDevelopmentReport;
      fetches: Record<BaciProofQueryKind, "fetched" | "use_cache">;
      observations: { created: number; existing: number };
    }
  | { outcome: "blocked"; reason: string }
  | { outcome: "source_conflict" }
  | { outcome: "observation_conflict"; reason: "material_mismatch" }
  | { outcome: "cache_incomplete" };

function persistedRowsAreComplete(
  rows: readonly MarketReadRepositoryObservation[],
  expectedRows: number,
  spec: BaciQuerySpec,
): boolean {
  if (rows.length !== expectedRows) return false;
  const seen = new Set<string>();
  for (const row of rows) {
    const year = Number(row.period);
    if (
      row.providerId !== "baci_oec" ||
      row.datasetId !== BACI_OEC_DATASET_ID ||
      row.reporterCountry !== spec.reporterCountry ||
      row.partnerCountry === null ||
      row.tradeFlow !== "import" ||
      row.hsRevision !== "HS17" ||
      row.hsCode !== spec.hsCode ||
      row.frequency !== "annual" ||
      !Number.isInteger(year) ||
      !spec.years.includes(year)
    ) return false;
    const key = `${row.period}|${row.partnerCountry}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

async function readBilateralRows(
  repository: ControlledBaciProofDependencies["repository"],
  reporter: BaciQuerySpec["reporterCountry"],
): Promise<MarketReadRepositoryObservation[]> {
  return repository.listBilateralAnnualObservations(
    reporter,
    "HS17",
    "090421",
    "baci_oec",
    BACI_OEC_DATASET_ID,
  );
}

/** Fixed MI1D.1 proof: one logical all-exporter query and raw-only persistence. */
export async function executeControlledMalaysiaChilliProof(
  dependencies: ControlledBaciProofDependencies,
): Promise<ControlledBaciProofResult> {
  return executeControlledChilliProof(buildMalaysiaChilliProofQuery(), dependencies);
}

/**
 * MI1F — cohort-generic execution primitive. Mirrors the Malaysia proof
 * but accepts any BaciQuerySpec built with the same HS proxy contract.
 * Malaysia continues to call this via `executeControlledMalaysiaChilliProof`.
 * The reporter, importer, and years all come from `spec`; behaviour is
 * otherwise identical to the MI1D proof, including the ledger-first
 * cache decision and the read-back completeness gate.
 */
export async function executeControlledChilliProof(
  spec: BaciQuerySpec,
  dependencies: ControlledBaciProofDependencies,
): Promise<ControlledBaciProofResult> {
  const now = dependencies.now ?? (() => new Date());
  const execution = await fetchBaciQueryWithLedger(spec, {
    env: dependencies.env,
    fetchImpl: dependencies.fetchImpl,
    quotaState: dependencies.quotaState,
    timeoutMs: dependencies.timeoutMs,
    now,
    loadLedger: ({ providerId, datasetId, queryFingerprint }) =>
      dependencies.repository.listRecentLedgerEntriesForFingerprint(
        providerId,
        datasetId,
        queryFingerprint,
      ),
    recordFetchResult: (input) => dependencies.writer.recordFetchResult(input),
  });
  if (execution.outcome === "blocked") {
    return { outcome: "blocked", reason: execution.reason };
  }

  const expectedRows = execution.outcome === "fetched"
    ? execution.result.totalRows
    : execution.expectedRows;
  const observations = execution.outcome === "fetched"
    ? normalizeBaciBilateralRows(execution.result.rows, now().toISOString())
    : [];

  let created = 0;
  let existing = 0;
  if (observations.length > 0) {
    const registered = await dependencies.repository.getSourceByProviderDataset(
      "baci_oec",
      BACI_OEC_DATASET_ID,
    );
    let sourceId = registered?.id;
    if (!sourceId) {
      const source = await dependencies.writer.ingestSource(
        buildBaciSourceRegistration(now().toISOString()),
      );
      if (source.outcome === "conflict") return { outcome: "source_conflict" };
      sourceId = source.id;
    }
    await dependencies.writer.verifySourceRights(buildBaciSourceVerification(sourceId));

    for (const row of observations) {
      const result = await dependencies.writer.ingestTradeObservation({
        sourceId,
        observation: toMarketTradeObservationBody(row),
      });
      if (result.outcome === "conflict") {
        return { outcome: "observation_conflict", reason: "material_mismatch" };
      }
      if (result.outcome === "created") created += 1;
      else existing += 1;
    }
  }

  const persisted = await readBilateralRows(dependencies.repository, spec.reporterCountry);
  if (!persistedRowsAreComplete(persisted, expectedRows, spec)) {
    return { outcome: "cache_incomplete" };
  }
  const report = buildBaciDevelopmentReport(persisted);

  // A non-empty success becomes authoritative only after the raw bilateral
  // set has survived persistence and read-back completeness validation.
  if (execution.outcome === "fetched" && execution.result.rows.length > 0) {
    await dependencies.writer.recordFetchResult(execution.completionLedgerRecord);
  }
  return {
    outcome: "completed",
    report,
    fetches: { canonical_bilateral: execution.outcome },
    observations: { created, existing },
  };
}
