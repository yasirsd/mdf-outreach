import type { BuyerTradeObservation } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PREFIX = "bi1";

export interface TradeCursor {
  tradeDate?: string;
  id: string;
}

/**
 * Database-only cursor. It contains the ordered DB keys, never a provider
 * cursor, and remains opaque to callers.
 */
export function encodeTradeCursor(cursor: TradeCursor): string {
  if (!UUID_RE.test(cursor.id)) throw new Error("Invalid trade cursor id");
  if (cursor.tradeDate && !DATE_RE.test(cursor.tradeDate)) {
    throw new Error("Invalid trade cursor date");
  }
  return `${PREFIX}|${cursor.tradeDate ?? "~"}|${cursor.id.toLowerCase()}`;
}

export function decodeTradeCursor(value: string | undefined): TradeCursor | undefined {
  if (!value) return undefined;
  const [prefix, date, id, extra] = value.split("|");
  if (prefix !== PREFIX || extra !== undefined || !UUID_RE.test(id ?? "")) {
    throw new Error("Invalid trade cursor");
  }
  if (date !== "~" && !DATE_RE.test(date ?? "")) {
    throw new Error("Invalid trade cursor");
  }
  return { tradeDate: date === "~" ? undefined : date, id: id.toLowerCase() };
}

export function cursorForObservation(row: BuyerTradeObservation): string {
  return encodeTradeCursor({ tradeDate: row.tradeDate, id: row.id });
}

export function clampTradePageLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 25;
  return Math.max(1, Math.min(100, Math.floor(value as number)));
}
