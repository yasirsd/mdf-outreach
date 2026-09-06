import { findBusinessProductById } from "@/lib/buyerFinder/businessCatalogue";

/** Validate normalized MDF interpretation against the canonical business catalogue. */
export function isMdfBusinessProductId(value: string | undefined): boolean {
  return !value || Boolean(findBusinessProductById(value));
}

export function requireMdfBusinessProductId(value: string): string {
  if (!findBusinessProductById(value)) {
    throw new Error(`Unknown MDF business product id: ${value}`);
  }
  return value;
}
