/**
 * TH04A — Thai Customs Data Catalog resource discovery.
 *
 * The official Customs Data Catalog is published on CKAN. Dataset
 * identifier for Thailand V1: `ctm_06_11` ("Imports by country of
 * origin"). Each monthly release surfaces as a new "resource"
 * attached to the dataset.
 *
 * Resource selection is deterministic and conservative:
 *
 *   • Only resources whose format metadata is CSV are eligible.
 *   • Only resources whose source period is in the past
 *     (year/month ≤ "latest-released" cutoff) are eligible.
 *     Unreleased / current-month resources are rejected explicitly.
 *   • Among eligible resources, the latest source period wins.
 *     Ties on period are broken by lexicographic resource id so
 *     the choice is stable across invocations.
 *
 * The CKAN API shape used:
 *
 *   GET https://catalog.customs.go.th/api/3/action/package_show?id=ctm_06_11
 *
 * expected to return a JSON envelope `{ success, result: { resources: [...] } }`.
 *
 * Transient fetch / metadata failures are reported as retryable so
 * the drain releases the lease with a short next_attempt_at; the
 * next cron tick retries. We NEVER fabricate a resource id.
 */

export const THAI_CUSTOMS_STATS_CATALOG_URL =
  "https://catalog.customs.go.th/api/3/action/package_show?id=ctm_06_11" as const;

export const THAI_CUSTOMS_STATS_DATASET_ID = "ctm_06_11" as const;

export class ThaiCustomsStatsCatalogError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) {
    super(message);
    this.name = "ThaiCustomsStatsCatalogError";
  }
}

export interface ThaiCustomsStatsResource {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly format: string;
  readonly year: number;
  readonly month: number;
  /** Period string `YYYY-MM`, derived from name/metadata. */
  readonly sourcePeriod: string;
  readonly metadataUpdatedAt: string | null;
}

/** Minimal CKAN envelope — only the fields we consume. */
export interface CkanPackageShowResponse {
  readonly success?: boolean;
  readonly result?: {
    readonly resources?: readonly {
      readonly id?: unknown;
      readonly name?: unknown;
      readonly url?: unknown;
      readonly format?: unknown;
      readonly last_modified?: unknown;
      readonly metadata_modified?: unknown;
      readonly created?: unknown;
    }[];
  };
}

const YEAR_MONTH_PATTERNS: readonly RegExp[] = [
  // 2026-09, 2026_09, 2026/09, 202609
  /(?<year>20[0-9]{2})[-_/]?(?<month>0[1-9]|1[0-2])(?![0-9])/,
  // Thai Buddhist Era (B.E.) 2569 corresponds to CE 2026; some
  // catalog resource names use the B.E. year. Convert BE → CE.
  /(?<beYear>25[0-9]{2})[-_/]?(?<month>0[1-9]|1[0-2])(?![0-9])/,
];

/** Extract (year, month) from the resource name / URL — returns null if ambiguous. */
function extractPeriod(name: string, url: string): { year: number; month: number } | null {
  const haystack = `${name} ${url}`;
  for (const re of YEAR_MONTH_PATTERNS) {
    const m = re.exec(haystack);
    if (!m) continue;
    const groups = m.groups ?? {};
    const month = Number(groups.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) continue;
    if (groups.year !== undefined) {
      const year = Number(groups.year);
      if (!Number.isInteger(year)) continue;
      return { year, month };
    }
    if (groups.beYear !== undefined) {
      const beYear = Number(groups.beYear);
      if (!Number.isInteger(beYear)) continue;
      return { year: beYear - 543, month };
    }
  }
  return null;
}

function compareResourcesLatestFirst(a: ThaiCustomsStatsResource, b: ThaiCustomsStatsResource): number {
  if (a.year !== b.year) return b.year - a.year;
  if (a.month !== b.month) return b.month - a.month;
  return a.id.localeCompare(b.id);
}

/**
 * Parse a CKAN envelope into the typed resource list. Rows missing
 * required fields are skipped silently; the function throws only
 * when the envelope itself is unusable. The caller decides what to
 * do with an empty resource list.
 */
export function parseCkanResources(envelope: CkanPackageShowResponse): ThaiCustomsStatsResource[] {
  if (!envelope || typeof envelope !== "object") {
    throw new ThaiCustomsStatsCatalogError("CATALOG_ENVELOPE_INVALID", true, "Thai Customs Data Catalog envelope is not a JSON object.");
  }
  if (envelope.success === false) {
    throw new ThaiCustomsStatsCatalogError("CATALOG_ENVELOPE_UNSUCCESSFUL", true, "Thai Customs Data Catalog envelope reported success=false.");
  }
  const resources = Array.isArray(envelope.result?.resources) ? envelope.result!.resources! : [];
  const out: ThaiCustomsStatsResource[] = [];
  for (const r of resources) {
    const id = typeof r.id === "string" ? r.id : null;
    const name = typeof r.name === "string" ? r.name : "";
    const url = typeof r.url === "string" ? r.url : "";
    const format = typeof r.format === "string" ? r.format.toUpperCase() : "";
    if (!id || !url) continue;
    if (format !== "CSV") continue;
    const period = extractPeriod(name, url);
    if (!period) continue;
    const metadataUpdatedAt =
      (typeof r.last_modified === "string" && r.last_modified)
      || (typeof r.metadata_modified === "string" && r.metadata_modified)
      || (typeof r.created === "string" && r.created)
      || null;
    out.push({
      id, name, url, format,
      year: period.year, month: period.month,
      sourcePeriod: `${period.year}-${String(period.month).padStart(2, "0")}`,
      metadataUpdatedAt: metadataUpdatedAt as string | null,
    });
  }
  return out;
}

/**
 * Pick the latest released resource. A resource whose
 * (year, month) is strictly later than the given
 * `latestReleasedPeriod` is rejected to prevent us from reading
 * unreleased or current-month data. When `latestReleasedPeriod`
 * is undefined, every resource is considered released.
 */
export function selectLatestReleasedResource(
  resources: readonly ThaiCustomsStatsResource[],
  latestReleasedPeriod?: { year: number; month: number },
): ThaiCustomsStatsResource | undefined {
  const eligible = resources.filter((r) => {
    if (!latestReleasedPeriod) return true;
    if (r.year < latestReleasedPeriod.year) return true;
    if (r.year > latestReleasedPeriod.year) return false;
    return r.month <= latestReleasedPeriod.month;
  });
  if (!eligible.length) return undefined;
  return [...eligible].sort(compareResourcesLatestFirst)[0];
}

/**
 * One-shot catalog fetch. Caller supplies `fetchImpl` (shared with
 * the rest of the executor so it can be stubbed in tests). Transient
 * failures become `retryable=true` catalog errors; schema failures
 * become `retryable=false`.
 */
export async function fetchThaiCustomsStatsCatalog(opts: {
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}): Promise<ThaiCustomsStatsResource[]> {
  let response: Response;
  try {
    response = await opts.fetchImpl(THAI_CUSTOMS_STATS_CATALOG_URL, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: opts.signal,
    });
  } catch (error) {
    throw new ThaiCustomsStatsCatalogError(
      "CATALOG_FETCH_FAILED",
      true,
      `Catalog fetch failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
  }
  if (!response.ok) {
    const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
    throw new ThaiCustomsStatsCatalogError(
      `CATALOG_HTTP_${response.status}`,
      retryable,
      `Catalog returned HTTP ${response.status}.`,
    );
  }
  let envelope: CkanPackageShowResponse;
  try {
    envelope = (await response.json()) as CkanPackageShowResponse;
  } catch {
    throw new ThaiCustomsStatsCatalogError("CATALOG_INVALID_JSON", true, "Catalog response was not valid JSON.");
  }
  return parseCkanResources(envelope);
}
