/**
 * F9-follow-up — types + constants for the filtered CSV export.
 *
 * Separated from `exportAction.ts` because Next.js "use server" files
 * may only export async functions. This module holds the shape and
 * the safety limit that both the action and the caller reference.
 */

export const EXPORT_CHUNK_SIZE = 500;
export const MAX_EXPORT_ROWS = 25_000;

export interface ExportBuyersFilter {
  search?: string;
  status?: string;
  country?: string;
  product?: string;
}

export interface ExportBuyersResult {
  csv: string;
  rowCount: number;
  truncated: boolean;
}

/**
 * Thrown by exportFilteredBuyersAction when the filter would produce
 * more than MAX_EXPORT_ROWS rows. The UI surfaces the message and asks
 * the operator to refine — we never silently truncate.
 */
export class ExportTooLargeError extends Error {
  readonly total: number;
  readonly limit: number = MAX_EXPORT_ROWS;
  constructor(total: number) {
    super(
      `Export exceeds the ${MAX_EXPORT_ROWS.toLocaleString()}-row safety limit ` +
        `(current filter matches ${total.toLocaleString()} buyers). ` +
        `Refine the filter and try again.`,
    );
    this.total = total;
    this.name = "ExportTooLargeError";
  }
}
