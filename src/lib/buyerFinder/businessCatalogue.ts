import { PRODUCTS, activeProducts, type CatalogueProduct } from "@/lib/catalogue/products";
import type { ProductKey } from "@/lib/email/themes/types";

/**
 * BF2 — Buyer Finder ↔ business catalogue bridge.
 *
 * AUTHORITY: `src/lib/catalogue/products.ts` is the single business
 * product catalogue for MDF Outreach. Buyer Finder MUST resolve display
 * name / search controls / persisted product identity through this
 * module. The email theme catalogue (`src/lib/email/themes/catalogue.ts`)
 * is NOT the business authority — it is only reached from here when a
 * business product's `emailThemeKey` bridge is needed by a downstream
 * theme-keyed helper (Hunter query keyword table, etc.).
 *
 * COMPAT NOTE — BF1 audit found:
 *   • Business product IDs and email theme ProductKey values are
 *     different strings (e.g. `guntur-dry-red-chilli` vs `guntur-chilli`).
 *   • The `buyer_candidate_product_matches.product_key` column has
 *     historically been written with ProductKey values by tests; no
 *     production writes have ever happened because the UI never wired
 *     to ingestion.
 *   • BF2 preserves the DB semantic (`product_key` = ProductKey) so no
 *     migration is required. UI + action consume business IDs; the
 *     bridge resolves `businessProductId → emailThemeKey → ProductKey`
 *     before touching persistence or Hunter keyword maps.
 */

export type BusinessProductId = string;

export interface BusinessProductSummary {
  id: BusinessProductId;
  displayName: string;
  shortName: string;
  emailThemeKey: ProductKey | null;
  active: boolean;
}

export function activeBusinessProducts(): BusinessProductSummary[] {
  return activeProducts().map(toSummary);
}

export function findBusinessProductById(
  id: string | undefined | null,
): BusinessProductSummary | undefined {
  if (!id) return undefined;
  const p = PRODUCTS.find((row) => row.id === id);
  return p ? toSummary(p) : undefined;
}

export function findBusinessProductByEmailThemeKey(
  key: ProductKey | string | undefined | null,
): BusinessProductSummary | undefined {
  if (!key) return undefined;
  const p = PRODUCTS.find((row) => row.emailThemeKey === key);
  return p ? toSummary(p) : undefined;
}

export function businessProductIdToEmailThemeKey(
  id: string | undefined | null,
): ProductKey | undefined {
  const p = findBusinessProductById(id);
  return p?.emailThemeKey ?? undefined;
}

export function isActiveBusinessProductId(id: string | undefined | null): boolean {
  const p = findBusinessProductById(id);
  return !!p && p.active;
}

function toSummary(p: CatalogueProduct): BusinessProductSummary {
  return {
    id: p.id,
    displayName: p.displayName,
    shortName: p.shortName,
    emailThemeKey: p.emailThemeKey,
    active: p.active,
  };
}
