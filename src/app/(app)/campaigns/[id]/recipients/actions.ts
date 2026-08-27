"use server";

import { serverRepositories } from "@/lib/repositories/server";
import type { Buyer } from "@/lib/types";

/**
 * MDF Outreach — F9-follow-up recipient candidate search.
 *
 * ─── ROOT CAUSE OF THE F9 FALSE-EMPTY BUG ─────────────────────────────
 *
 * F9 originally over-fetched a single 2×-pageSize chunk and returned
 * whatever survived exclusion. If the first ~2× page happened to be
 * dominated by buyers already on the campaign, the result was empty —
 * even when eligible matches existed on later pages.
 *
 * ─── FINAL ALGORITHM ──────────────────────────────────────────────────
 *
 * Bounded ITERATION rather than single over-fetch. We fetch chunks of
 * `SCAN_CHUNK_SIZE` (100) from `listPaginated` starting at the caller's
 * page, filter out existing recipients in JS, and continue until EITHER
 * (a) we have `pageSize` eligible rows, OR (b) the underlying paginated
 * source is exhausted, OR (c) we hit the safety scan cap. The safety
 * cap bounds the total DB rows scanned per action call to
 * `MAX_SCAN_ROWS` = 1_000; large results legitimately need to be split
 * across successive UI queries.
 *
 * We deliberately DO NOT push the exclusion into the SQL layer via
 * `.not.in.(uuid,uuid,…)` — a large existing-recipients list would blow
 * the PostgREST URL. The in-memory filter is safe because chunks are
 * bounded and the caller can only advance one "logical" page at a time.
 *
 * ─── SAFETY ───────────────────────────────────────────────────────────
 *
 *   • Auth-gated by `serverRepositories` → `requireMdfSession` (RLS).
 *   • Browser NEVER supplies `workspaceId`.
 *   • `campaignId` validated as UUID + confirmed present in workspace.
 *   • Existing-recipients determined authoritatively by
 *     `recipients.listByCampaign(campaignId)`.
 *   • Result set bounded (default 25, max 100).
 *   • Total DB rows scanned per call bounded (`MAX_SCAN_ROWS = 1_000`).
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const SCAN_CHUNK_SIZE = 100;
const MAX_SCAN_ROWS = 1_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AvailableBuyerRow {
  id: string;
  company: string;
  firstName: string;
  lastName: string;
  email: string;
  country: string;
  productInterest?: string;
  status: string;
}

export interface AvailableBuyersResult {
  rows: AvailableBuyerRow[];
  /**
   * True when the underlying result set is exhausted at the last-scanned
   * position. The UI should render "No additional matching buyers"
   * only when this is true AND `rows` is empty.
   */
  exhausted: boolean;
  /**
   * True when we hit `MAX_SCAN_ROWS` without finding `pageSize`
   * eligible rows. UI can offer "Refine your search" guidance.
   */
  hitScanCap: boolean;
  /** Total DB rows we scanned to build this result (for telemetry). */
  scannedRows: number;
  pageSize: number;
}

export interface SearchAvailableRecipientsInput {
  campaignId: string;
  query?: string;
  status?: string;
  country?: string;
  product?: string;
  pageSize?: number;
}

export async function searchAvailableRecipientsAction(
  input: SearchAvailableRecipientsInput,
): Promise<AvailableBuyersResult> {
  if (!UUID_RE.test(input.campaignId)) {
    throw new Error("Invalid campaign id.");
  }

  const { repos } = await serverRepositories();

  // Confirm the campaign exists AND is visible in the caller's workspace.
  // RLS is what actually enforces workspace isolation.
  const campaign = await repos.campaigns.get(input.campaignId);
  if (!campaign) throw new Error("Campaign not found.");

  // Existing recipients — the authoritative exclusion set.
  const existing = await repos.recipients.listByCampaign(input.campaignId);
  const excludedIds = new Set(existing.map((r) => r.buyerId));

  const pageSize = clamp(input.pageSize ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

  const eligible: AvailableBuyerRow[] = [];
  const seen = new Set<string>();
  let scannedRows = 0;
  let scanPage = 1;
  let exhausted = false;

  while (eligible.length < pageSize && scannedRows < MAX_SCAN_ROWS) {
    const remainingBudget = MAX_SCAN_ROWS - scannedRows;
    const chunkSize = Math.min(SCAN_CHUNK_SIZE, remainingBudget);
    const paged = await repos.buyers.listPaginated({
      page: scanPage,
      pageSize: chunkSize,
      search: input.query,
      status: input.status,
      country: input.country,
      product: input.product,
    });
    scannedRows += paged.rows.length;

    for (const b of paged.rows) {
      if (excludedIds.has(b.id)) continue;
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      eligible.push(toRow(b));
      if (eligible.length >= pageSize) break;
    }

    // Have we consumed every buyer PostgREST is willing to return under
    // the given filter? paged.total is authoritative from PostgREST's
    // count: 'exact' response.
    const totalConsumed = scanPage * chunkSize;
    if (paged.rows.length === 0 || totalConsumed >= paged.total) {
      exhausted = true;
      break;
    }
    scanPage += 1;
  }

  const hitScanCap = !exhausted && scannedRows >= MAX_SCAN_ROWS && eligible.length < pageSize;

  return {
    rows: eligible,
    exhausted,
    hitScanCap,
    scannedRows,
    pageSize,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function toRow(b: Buyer): AvailableBuyerRow {
  return {
    id: b.id,
    company: b.company ?? "",
    firstName: b.firstName ?? "",
    lastName: b.lastName ?? "",
    email: b.email ?? "",
    country: b.country ?? "",
    productInterest: b.productInterest,
    status: b.status,
  };
}

/**
 * PURE core of the algorithm, exported for behavioural testing. The
 * production entry point uses `repos.buyers.listPaginated` under the
 * hood; tests inject a fake source with a known page shape and known
 * pre-existing recipient set to prove the iteration behaviour.
 *
 * Contract:
 *   • fetchPage(page, chunkSize) must return `{ rows, total }` where
 *     `rows.length <= chunkSize` and `total` is the underlying source
 *     total (matching what PostgREST would return with count: 'exact').
 *   • excludedIds is honoured exactly.
 *   • Result never contains a duplicate row.
 *   • Result never contains a row in excludedIds.
 *   • Result length is at most pageSize.
 *   • `exhausted` is true only when the source is fully consumed.
 *   • `hitScanCap` is true only when we scanned MAX_SCAN_ROWS without
 *     collecting pageSize eligible rows.
 */
export async function iterateEligibleCandidates(input: {
  fetchPage: (
    page: number,
    chunkSize: number,
  ) => Promise<{ rows: { id: string; buyer: Buyer }[]; total: number }>;
  excludedIds: Set<string>;
  pageSize: number;
  scanChunkSize?: number;
  maxScanRows?: number;
}): Promise<{
  rows: AvailableBuyerRow[];
  exhausted: boolean;
  hitScanCap: boolean;
  scannedRows: number;
}> {
  const pageSize = clamp(input.pageSize, 1, MAX_PAGE_SIZE);
  const chunkCap = clamp(input.scanChunkSize ?? SCAN_CHUNK_SIZE, 1, SCAN_CHUNK_SIZE);
  const scanCap = clamp(input.maxScanRows ?? MAX_SCAN_ROWS, 1, MAX_SCAN_ROWS);

  const eligible: AvailableBuyerRow[] = [];
  const seen = new Set<string>();
  let scannedRows = 0;
  let scanPage = 1;
  let exhausted = false;

  while (eligible.length < pageSize && scannedRows < scanCap) {
    const remainingBudget = scanCap - scannedRows;
    const chunkSize = Math.min(chunkCap, remainingBudget);
    const paged = await input.fetchPage(scanPage, chunkSize);
    scannedRows += paged.rows.length;

    for (const r of paged.rows) {
      if (input.excludedIds.has(r.id)) continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      eligible.push(toRow(r.buyer));
      if (eligible.length >= pageSize) break;
    }

    const totalConsumed = scanPage * chunkSize;
    if (paged.rows.length === 0 || totalConsumed >= paged.total) {
      exhausted = true;
      break;
    }
    scanPage += 1;
  }

  const hitScanCap = !exhausted && scannedRows >= scanCap && eligible.length < pageSize;
  return { rows: eligible, exhausted, hitScanCap, scannedRows };
}
