/**
 * MI0.1 — MDF product ↔ HS classification mapping.
 *
 * Operators pick an MDF product ("Guntur Dry Red Chilli"); MI drives
 * every trade query from the mapping declared here. Products may map
 * to more than one HS code across revisions; every code declares its
 * revision AND its specificity to the MDF product explicitly.
 *
 * MI never lies about specificity. HS is a taxonomy of trade
 * classifications; at global HS-6 resolution some MDF products land
 * inside broad buckets where the MDF item is one of many unrelated
 * products. MI records this as `mappingKind = "composite"` and gates
 * the Market Fit score off numeric publication for that code, so an
 * operator never sees a precise pomegranate score derived from
 * "other fresh fruit". Trade proxies (e.g. "dried Capsicum/Pimenta"
 * for Guntur chilli) are allowed but must be labelled as proxies in
 * the UI.
 *
 * MI0 does NOT aggregate across codes automatically. A future MI1
 * ingestion path may sum codes only when their `weight` values are
 * documented and their revisions match. For now the registry is a
 * transparent, versioned record the operator can inspect.
 *
 * The MDF product catalogue (`src/lib/catalogue/products.ts`) remains
 * the source of truth for product identity; this module only records
 * how each product corresponds to standard trade codes.
 */

import { PRODUCTS, type CatalogueProduct } from "@/lib/catalogue/products";
import type {
  HsLevel,
  HsRevision,
  MappingFitEligibility,
  MappingKind,
  MdfProductId,
  ProductTradeMapping,
} from "./types";

/**
 * MI1C — mapping registry version. Bumped intentionally whenever the
 * TypeScript registry below changes (a new product, a re-classified
 * proxy → composite, a confidence-band adjustment, etc.). The
 * sync RPC stamps this on every persisted mirror row so the
 * database can prove which registry generation it reflects.
 *
 * Never derived from the current date.
 */
export const MI_PRODUCT_MAPPING_VERSION = "mi-product-map-v1";

/**
 * MI0.1 initial mapping. Values are conventional HS17 codes each
 * MDF product falls under at 6-digit resolution. **Specificity is
 * declared explicitly.** MI1 may extend the registry with additional
 * revisions once real ingestion is wired.
 *
 * References (informational, not fetched):
 *   • HS17 0904.21 — Fruits of genus Capsicum or Pimenta, dried,
 *     neither crushed nor ground.
 *   • HS17 0904.22 — Fruits of genus Capsicum or Pimenta, crushed
 *     or ground.
 *   • HS17 0804.50 — Guavas, mangoes and mangosteens, fresh or dried.
 *   • HS17 0810.90 — Other fresh fruit (basket line).
 *   • HS17 0808.10 — Fresh apples.
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
    mappingKind: "proxy",
    mappingConfidence: 0.7,
    scopeDescription:
      "Trade proxy: covers every dried whole chilli/pimenta shipment, not only Guntur variety.",
    includedProductsNote:
      "Includes dried whole chillies of all origins/varieties (paprika-type, cayenne, bird's eye, etc.).",
  },
  {
    mdfProductId: "guntur-dry-red-chilli",
    hsRevision: "HS17",
    hsLevel: 6,
    hsCode: "090422",
    tradeLabel: "Fruits of the genus Capsicum or Pimenta, crushed or ground",
    form: "crushed / powder",
    notes: "Enable only after MI1 confirms operator intent to include ground forms.",
    weight: 0.5,
    mappingKind: "proxy",
    mappingConfidence: 0.55,
    scopeDescription:
      "Trade proxy: covers ground/crushed Capsicum shipments — includes chilli powder from all origins.",
    includedProductsNote:
      "Chilli powder / crushed chilli of any variety; not variety-specific to Guntur.",
  },
  {
    mdfProductId: "banganapalli-mango",
    hsRevision: "HS17",
    hsLevel: 6,
    hsCode: "080450",
    tradeLabel: "Guavas, mangoes and mangosteens, fresh or dried",
    form: "fresh (heading shared with guava and mangosteen)",
    weight: 0.6,
    mappingKind: "composite",
    mappingConfidence: 0.3,
    scopeDescription:
      "Composite bucket: 'Guavas, mangoes and mangosteens'. Not mango-only and not variety-specific to Banganapalli.",
    includedProductsNote:
      "Guavas + mangoes (all varieties) + mangosteens — three distinct fruit types share this heading.",
  },
  {
    mdfProductId: "indian-pomegranate",
    hsRevision: "HS17",
    hsLevel: 6,
    hsCode: "081090",
    tradeLabel: "Other fresh fruit (broad basket including pomegranate)",
    form: "fresh (broad basket line)",
    weight: 0.3,
    mappingKind: "composite",
    mappingConfidence: 0.25,
    scopeDescription:
      "Composite bucket: broad 'other fresh fruit' line. Pomegranate is one of many items; global HS-6 cannot isolate it.",
    includedProductsNote:
      "Includes tamarinds, cashew apples, jackfruit, lychees, sapodillas, pomegranate, and many other fresh fruits. National 8/10-digit systems may split pomegranate; global BACI HS-6 cannot.",
  },
  {
    mdfProductId: "indian-apples",
    hsRevision: "HS17",
    hsLevel: 6,
    hsCode: "080810",
    tradeLabel: "Fresh apples",
    form: "fresh",
    weight: 1,
    mappingKind: "exact",
    mappingConfidence: 0.95,
    scopeDescription:
      "Exact code for fresh apples. 'Indian' apples are determined by the origin/partner country, not the product code.",
    includedProductsNote:
      "All fresh apples worldwide; 'Indian' apples are the India-origin subset of this code.",
  },
]);

/**
 * MI0.1 — derived eligibility from `mappingKind`. Never bypassed at
 * ingestion time; MI publishes a numeric Market Fit only where at
 * least one contributing code returns `exact` or `proxy_allowed`.
 */
export function mappingFitEligibility(kind: MappingKind): MappingFitEligibility {
  if (kind === "exact") return "exact";
  if (kind === "proxy") return "proxy_allowed";
  return "insufficient_specificity";
}

/**
 * MI0.1 — the best (most-specific) eligibility across all mappings
 * for a product. Used by the Market Fit gate to decide whether the
 * numeric score is publishable, publishable-as-proxy, or must be
 * withheld.
 */
export function productFitEligibility(productId: MdfProductId): MappingFitEligibility {
  const rows = mappingsForProduct(productId);
  if (rows.length === 0) return "insufficient_specificity";
  const eligibilities = rows.map((m) => mappingFitEligibility(m.mappingKind));
  if (eligibilities.includes("exact")) return "exact";
  if (eligibilities.includes("proxy_allowed")) return "proxy_allowed";
  return "insufficient_specificity";
}

/**
 * MI0.1 — highest mapping confidence across a product's codes, used
 * by `composeDataConfidence`'s `hsMappingCertainty` axis. Range 0..1.
 */
export function productMappingCertainty(productId: MdfProductId): number {
  const rows = mappingsForProduct(productId);
  if (rows.length === 0) return 0;
  return Math.max(...rows.map((m) => m.mappingConfidence));
}

/**
 * MI1C — canonical snapshot of the TS registry, sent to the SQL sync RPC.
 *
 * The snapshot is a FULL current-state payload; the RPC deactivates
 * mappings that are absent from it and reactivates any that return.
 * The serialization refuses to emit a snapshot whose structural
 * validation fails, so a broken registry never reaches the database.
 *
 * `registryVersion` MUST be non-blank; the SQL side enforces the
 * same rule. Identity (`mdfProductId + hsRevision + hsCode`) inside
 * the snapshot must be unique — duplicate rows are rejected here
 * BEFORE any RPC call.
 */
export interface ProductTradeMappingSnapshot {
  registryVersion: string;
  generatedAt: string;
  mappings: ProductTradeMapping[];
}

export class ProductTradeMappingSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductTradeMappingSnapshotError";
  }
}

/**
 * Freeze-and-validate the TypeScript registry into a canonical
 * snapshot suitable for the sync RPC. Every call re-runs
 * `validateProductTradeMappings()` so schema drift is caught before
 * we serialize.
 */
export function serializeProductTradeMappingsSnapshot(
  options: { now?: () => Date } = {},
): ProductTradeMappingSnapshot {
  const errors = validateProductTradeMappings();
  if (errors.length > 0) {
    throw new ProductTradeMappingSnapshotError(
      `product_trade_mappings registry is invalid; refusing to serialize: ${errors.join("; ")}`,
    );
  }
  const seen = new Set<string>();
  for (const m of PRODUCT_TRADE_MAPPINGS) {
    const key = `${m.mdfProductId}::${m.hsRevision}::${m.hsCode}`;
    if (seen.has(key)) {
      throw new ProductTradeMappingSnapshotError(
        `duplicate mapping identity in registry: ${key}`,
      );
    }
    seen.add(key);
  }
  const now = (options.now ?? (() => new Date()))();
  return {
    registryVersion: MI_PRODUCT_MAPPING_VERSION,
    generatedAt: now.toISOString(),
    // Emit a stable order so a replay produces the same wire bytes.
    mappings: [...PRODUCT_TRADE_MAPPINGS].sort((a, b) => {
      const ak = `${a.mdfProductId}::${a.hsRevision}::${a.hsCode}`;
      const bk = `${b.mdfProductId}::${b.hsRevision}::${b.hsCode}`;
      return ak.localeCompare(bk);
    }),
  };
}

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
 *   • must have a weight in (0, 1] when supplied,
 *   • must declare a mapping kind and a confidence in (0, 1],
 *   • must have a non-empty scope description,
 *   • must have a confidence consistent with its kind:
 *       exact ≥ 0.85, proxy in (0.4, 0.85), composite ≤ 0.4.
 *
 * Callers should treat a non-empty error list as a build-time defect;
 * MI0.1 tests assert it stays empty.
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
    if (m.scopeDescription.trim().length === 0) {
      errors.push(`Scope description missing: ${m.mdfProductId} / ${m.hsCode}`);
    }
    if (m.mappingConfidence <= 0 || m.mappingConfidence > 1) {
      errors.push(
        `mappingConfidence out of range (0,1]: ${m.mdfProductId} / ${m.hsCode} = ${m.mappingConfidence}`,
      );
    }
    if (m.mappingKind === "exact" && m.mappingConfidence < 0.85) {
      errors.push(
        `exact mapping must carry confidence >= 0.85: ${m.mdfProductId} / ${m.hsCode}`,
      );
    }
    if (m.mappingKind === "proxy" && (m.mappingConfidence <= 0.4 || m.mappingConfidence > 0.85)) {
      errors.push(
        `proxy mapping must carry confidence in (0.4, 0.85]: ${m.mdfProductId} / ${m.hsCode}`,
      );
    }
    if (m.mappingKind === "composite" && m.mappingConfidence > 0.4) {
      errors.push(
        `composite mapping must carry confidence <= 0.4: ${m.mdfProductId} / ${m.hsCode}`,
      );
    }
  }
  return errors;
}
