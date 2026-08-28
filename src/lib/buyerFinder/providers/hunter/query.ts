/**
 * Hunter Discover query construction.
 *
 * BF2.1 — keyed by BUSINESS product ids (src/lib/catalogue/products.ts).
 * The Buyer Finder provider layer NEVER touches email-theme ProductKey.
 *
 * keywords.match = "any" on purpose: requiring every product keyword AND
 * every commercial phrase (match: "all") is too restrictive for discovery.
 *
 * Hunter company_type (privately_held, public_company, …) is never used.
 * MDF Importer/Distributor/Wholesaler search intent is NOT mapped to that
 * filter and is never carried into candidate.buyerType.
 *
 * Generic tokens such as "import" / "importer" / "export" / "logistics" /
 * "freight" are rejected: they match banks, freight forwarders, and
 * machinery firms rather than chilli buyers.
 *
 * Hunter industry.include is never sent — arbitrary MDF industry strings
 * are appended as keywords instead, to avoid fragile 400s.
 */

import { isActiveBusinessProductId } from "@/lib/buyerFinder/businessCatalogue";
import type { BuyerTypeOption } from "@/lib/buyerFinder/types";
import { blankToUndefined } from "@/lib/buyerFinder/normalize";
import { codeForCountryName, findCountryByCode } from "@/lib/catalogue/countries";
import type { BusinessProductId, CompanyDiscoveryQuery } from "../types";
import { HunterDiscoveryError } from "./errors";

export const HUNTER_DISCOVER_URL = "https://api.hunter.io/v2/discover";

export type HunterKeywordIntent = "product-led" | "food-trade" | "hybrid";

/** Whole-token rejects. "food importer" is allowed; standalone "import" is not. */
export const REJECTED_GENERIC_KEYWORDS: readonly string[] = [
  "import",
  "importer",
  "export",
  "exporter",
  "logistics",
  "freight",
];

/**
 * Product search keywords, keyed by BUSINESS product id.
 * Not a second product identity — purely a Hunter query-keyword table.
 */
export const PRODUCT_SEARCH_KEYWORDS: Record<BusinessProductId, readonly string[]> = {
  "guntur-dry-red-chilli": [
    "dry red chilli",
    "red chilli",
    "chilli",
    "chili",
    "spices",
    "food spices",
  ],
  "banganapalli-mango": ["mango", "fresh mango", "fresh fruit"],
  "indian-pomegranate": ["pomegranate", "fresh fruit"],
  "indian-apples": ["apple", "fresh apple", "fresh fruit"],
};

export const FOOD_TRADE_INTENT_KEYWORDS: readonly string[] = [
  "food importer",
  "spice importer",
  "spice distributor",
  "food distributor",
  "chilli distributor",
  "chili distributor",
  "spice trading",
  "food trading",
];

/** 4–6 high-signal phrases for chilli. Other business ids fall back to product-led. */
export const HYBRID_SEARCH_KEYWORDS: Partial<Record<BusinessProductId, readonly string[]>> = {
  "guntur-dry-red-chilli": [
    "dry red chilli",
    "red chilli",
    "spice importer",
    "food importer",
    "spice trading",
    "chilli distributor",
  ],
};

/**
 * @deprecated Buyer-type tokens are no longer injected as Hunter keywords.
 * Kept as an empty map so tests can prove Importer ≠ Hunter company_type
 * and that generic "import" is not used.
 */
export const BUYER_TYPE_SEARCH_KEYWORDS: Record<BuyerTypeOption, readonly string[]> = {
  Importer: [],
  Distributor: [],
  Wholesaler: [],
};

export interface HunterDiscoverBody {
  headquarters_location: {
    include: Array<{ country: string }>;
  };
  keywords: {
    match: "any";
    include: string[];
  };
}

export interface HunterDiscoverPlan {
  isoCountry: string;
  keywords: string[];
  intent: HunterKeywordIntent;
  body: HunterDiscoverBody;
}

/** Resolve an MDF country name, alias (UAE), or ISO code to alpha-2. Isolated wrapper over the existing catalogue. */
export function countryToIsoAlpha2(country: string | null | undefined): string | undefined {
  const raw = blankToUndefined(country);
  if (!raw) return undefined;
  if (/^[A-Za-z]{2}$/.test(raw)) return findCountryByCode(raw)?.code;
  return codeForCountryName(raw);
}

function uniqueKeywords(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = v.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function isRejectedGenericKeyword(value: string): boolean {
  return REJECTED_GENERIC_KEYWORDS.includes(value.trim().toLowerCase());
}

function withoutRejected(values: string[]): string[] {
  return values.filter((v) => !isRejectedGenericKeyword(v));
}

export function collectHunterKeywords(query: {
  productId: BusinessProductId;
  buyerTypes?: BuyerTypeOption[];
  industry?: string;
  keywordIntent?: HunterKeywordIntent;
}): string[] {
  const intent: HunterKeywordIntent = query.keywordIntent ?? "product-led";
  const parts: string[] = [];
  if (intent === "hybrid") {
    const hybrid = HYBRID_SEARCH_KEYWORDS[query.productId];
    parts.push(...(hybrid ?? PRODUCT_SEARCH_KEYWORDS[query.productId] ?? []));
  } else {
    parts.push(...(PRODUCT_SEARCH_KEYWORDS[query.productId] ?? []));
    if (intent === "food-trade") {
      parts.push(...FOOD_TRADE_INTENT_KEYWORDS);
    }
  }
  // Search intent is NOT injected as keywords — Hunter would match
  // freight/import companies. Kept only on the search-run record.
  void query.buyerTypes;
  const industry = blankToUndefined(query.industry);
  if (industry && !isRejectedGenericKeyword(industry)) parts.push(industry);
  return withoutRejected(uniqueKeywords(parts));
}

/** Build the Hunter POST body. Throws before any network concern if country/product are invalid. */
export function buildHunterDiscoverPlan(query: CompanyDiscoveryQuery): HunterDiscoverPlan {
  if (!isActiveBusinessProductId(query.productId)) {
    throw new HunterDiscoveryError(
      "invalid_input",
      `Invalid MDF business product id: ${String(query.productId || "(empty)")}`,
    );
  }
  const isoCountry = countryToIsoAlpha2(query.country);
  if (!isoCountry) {
    throw new HunterDiscoveryError(
      "invalid_input",
      `Unsupported or empty country: ${blankToUndefined(query.country) ?? "(empty)"}`,
    );
  }
  const intent: HunterKeywordIntent = query.keywordIntent ?? "product-led";
  const keywords = collectHunterKeywords({
    productId: query.productId,
    buyerTypes: query.buyerTypes,
    industry: query.industry,
    keywordIntent: intent,
  });
  if (keywords.length === 0) {
    throw new HunterDiscoveryError("invalid_input", "Hunter Discover requires at least one keyword.");
  }
  const body: HunterDiscoverBody = {
    headquarters_location: {
      include: [{ country: isoCountry }],
    },
    keywords: {
      match: "any",
      include: keywords,
    },
  };
  return { isoCountry, keywords, intent, body };
}
