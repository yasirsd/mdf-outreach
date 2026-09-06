/**
 * MI0 — MDF product ↔ HS classification mapping.
 *
 * Operators pick an MDF product ("Guntur Dry Red Chilli"); MI drives
 * every trade query from the mapping declared here. Products may map
 * to more than one HS code across revisions; every code declares its
 * revision explicitly so the ingestion pipeline never compares
 * incompatible classifications.
 *
 * MI0 does NOT aggregate across codes automatically. A future MI1
 * ingestion path may sum codes only when their `weight` values are
 * documented and their revisions match. For now the mapping is a
 * transparent registry the operator can inspect.
 *
 * The MDF product catalogue (`src/lib/catalogue/products.ts`) remains
 * the source of truth for product identity; this module only records
 * how each product corresponds to standard trade codes.
 */

import { PRODUCTS, type CatalogueProduct } from "@/lib/catalogue/products";
import type {
  HsLevel,
  HsRevision,
  MdfProductId,
  ProductTradeMapping,
} from "./types";

/**
 * Initial MI0 mapping. Values are the conventional HS17 codes each MDF
 * product falls under at 6-digit resolution. This registry is
 * deliberately small and versioned; MI1 may extend it with additional
 * revisions once real ingestion is wired.
 *
 * References (informational, not fetched):
 *   • Chilli, whole / crushed / powder → HS17 0904.21 / 0904.22
 *   • Fresh mango → HS17 0804.50 (mango, mangosteen, guava)
 *   • Fresh pomegranate → HS17 0810.90 (other fresh fruit)
 *   • Fresh apple → HS17 0808.10
 *
 * Codes marked with `weight < 1` share coverage with other products
 * in the same HS heading (e.g. mango + mangosteen + guava all sit in
 * 0804.50). MI does not silently divide; the weight is a documented
 * hint for a future aggregation review.
 */
export const PRODUCT_TRADE_MAPPINGS: readonly ProductTradeMapping[] = Object.freeze([
  {
    mdfProductId: "guntur-dry-red-chilli",
    hsRevision: "HS17",
    hsLevel: 6,
    hsCode: "090421",
    tradeLabel: "Fruits of the genus Capsicum or Pimenta, dried, neither crushed nor ground",
    form: "dried, whole",
    weight: 1,
  },
  {
    mdfProductId: "guntur-dry-red-chilli",
    hsRevision: "HS17",
    hsLevel: 6,
    hsCode: "090422",
    tradeLabel: "Fruits of the genus Capsicum or Pimenta, dried, crushed or ground",
    form: "crushed / powder",
    notes: "Enable only after MI1 confirms operator intent to include ground forms.",
    weight: 0.5,
  },
  {
    mdfProductId: "banganapalli-mango",
    hsRevision: "HS17",
    hsLevel: 6,
    hsCode: "080450",
    tradeLabel: "Fresh or dried guavas, mangoes and mangosteens",
    form: "fresh (heading shared with guava and mangosteen)",
    weight: 0.6,
    notes: "Heading is not variety-specific; MI must report as guavas/mangoes/mangosteens.",
  },
  {
    mdfProductId: "indian-pomegranate",
    hsRevision: "HS17",
    hsLevel: 6,
    hsCode: "081090",
    tradeLabel: "Other fresh fruit (includes pomegranate)",
    form: "fresh (broad basket line)",
    weight: 0.3,
    notes: "Pomegranate is not broken out in HS17; MI must report the basket coverage.",
  },
  {
    mdfProductId: "indian-apples",
    hsRevision: "HS17",
    hsLevel: 6,
    hsCode: "080810",
    tradeLabel: "Fresh apples",
    form: "fresh",
    weight: 1,
  },
]);

export function mappingsForProduct(productId: MdfProductId): ProductTradeMapping[] {
  return PRODUCT_TRADE_MAPPINGS.filter((m) => m.mdfProductId === productId);
}

export function mappingsForProductAndRevision(
  productId: MdfProductId,
  revision: HsRevision,
): ProductTradeMapping[] {
  return PRODUCT_TRADE_MAPPINGS.filter(
    (m) => m.mdfProductId === productId && m.hsRevision === revision,
  );
}

export function knownMdfProduct(productId: MdfProductId): CatalogueProduct | undefined {
  return PRODUCTS.find((p) => p.id === productId);
}

/**
 * Structural mapping sanity check — every declared code:
 *   • must correspond to an existing MDF business product,
 *   • must be digits-only,
 *   • must match the declared HS level's digit count,
 *   • must have a trade label,
 *   • must have a weight in (0, 1] when supplied.
 *
 * Callers should treat a non-empty error list as a build-time defect;
 * MI0 tests assert it stays empty.
 */
export function validateProductTradeMappings(): string[] {
  const errors: string[] = [];
  const digitsByLevel: Record<HsLevel, number> = { 2: 2, 4: 4, 6: 6 };
  for (const m of PRODUCT_TRADE_MAPPINGS) {
    if (!knownMdfProduct(m.mdfProductId)) {
      errors.push(`Unknown MDF product id in mapping: ${m.mdfProductId}`);
    }
    if (!/^\d+$/.test(m.hsCode)) {
      errors.push(`HS code must be digits only: ${m.mdfProductId} / ${m.hsCode}`);
    }
    if (m.hsCode.length !== digitsByLevel[m.hsLevel]) {
      errors.push(
        `HS code length ${m.hsCode.length} does not match declared level ${m.hsLevel}: ${m.mdfProductId} / ${m.hsCode}`,
      );
    }
    if (m.tradeLabel.trim().length === 0) {
      errors.push(`Trade label missing: ${m.mdfProductId} / ${m.hsCode}`);
    }
    if (m.weight !== undefined && (m.weight <= 0 || m.weight > 1)) {
      errors.push(`Weight out of range (0,1]: ${m.mdfProductId} / ${m.hsCode}`);
    }
  }
  return errors;
}
