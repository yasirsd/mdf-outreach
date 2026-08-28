import { isActiveBusinessProductId } from "./businessCatalogue";
import type { BusinessProductId } from "./types";

/**
 * BF2.1 — Buyer Finder domain uses BUSINESS product ids only.
 * (`productKey.ts` filename retained for compatibility; new callers
 * should prefer `requireBusinessProductId`.)
 */
export function requireBusinessProductId(value: string | null | undefined): BusinessProductId {
  if (!isActiveBusinessProductId(value)) {
    throw new Error(`Invalid MDF business product id: ${value ?? "(empty)"}`);
  }
  return value as BusinessProductId;
}

/** @deprecated — kept only to avoid rippling into consumers this pass. */
export const requireProductKey = requireBusinessProductId;
