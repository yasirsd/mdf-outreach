"use server";

import { serverRepositories } from "@/lib/repositories/server";
import { buyersToCsv } from "@/lib/csv";
import type { Buyer } from "@/lib/types";
import {
  EXPORT_CHUNK_SIZE,
  ExportTooLargeError,
  MAX_EXPORT_ROWS,
  type ExportBuyersFilter,
  type ExportBuyersResult,
} from "./exportTypes";

/**
 * MDF Outreach — F9-follow-up server-side filtered CSV export.
 *
 * See ./exportTypes.ts for shape + safety limit + custom error class.
 *
 * Behaviour:
 *   • Uses the SAME server-side filters as the Buyers page loader.
 *   • Iterates `listPaginated` in bounded chunks of EXPORT_CHUNK_SIZE.
 *   • Safety cap: MAX_EXPORT_ROWS. Beyond that the operator is asked to
 *     refine their filter — we NEVER silently truncate.
 *   • CSV cells are formula-injection-neutralised (see lib/csv.ts).
 *
 * Security:
 *   • Auth-gated by `serverRepositories` → `requireMdfSession`.
 *   • Browser never supplies workspaceId.
 *   • RLS scopes every query.
 *   • Returns a plain string CSV; caller (client) builds a Blob and
 *     triggers a download.
 */
export async function exportFilteredBuyersAction(
  filter: ExportBuyersFilter = {},
): Promise<ExportBuyersResult> {
  const { repos } = await serverRepositories();

  // Sniff total first so we can refuse cleanly.
  const sniff = await repos.buyers.listPaginated({
    page: 1,
    pageSize: 1,
    search: filter.search,
    status: filter.status,
    country: filter.country,
    product: filter.product,
  });

  if (sniff.total > MAX_EXPORT_ROWS) {
    throw new ExportTooLargeError(sniff.total);
  }

  const collected: Buyer[] = [];
  let page = 1;
  while (collected.length < sniff.total) {
    const paged = await repos.buyers.listPaginated({
      page,
      pageSize: EXPORT_CHUNK_SIZE,
      search: filter.search,
      status: filter.status,
      country: filter.country,
      product: filter.product,
    });
    if (paged.rows.length === 0) break;
    for (const b of paged.rows) collected.push(b);
    if (collected.length >= MAX_EXPORT_ROWS) break;
    if (page * EXPORT_CHUNK_SIZE >= paged.total) break;
    page += 1;
  }

  return {
    csv: buyersToCsv(collected),
    rowCount: collected.length,
    truncated: false,
  };
}
