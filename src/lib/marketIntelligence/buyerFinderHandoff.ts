import { findCountryByCode } from "@/lib/catalogue/countries";
import { PRODUCTS } from "@/lib/catalogue/products";

export const MARKET_INTELLIGENCE_HANDOFF_SOURCE = "market-intelligence" as const;
const RETURN_COMPARISON_PARAM = "returnCompare";

export interface MarketIntelligenceBuyerFinderHandoff {
  source: typeof MARKET_INTELLIGENCE_HANDOFF_SOURCE;
  productId: string;
  productName: string;
  countryAlpha2: string;
  countryName: string;
  returnComparison: string[];
}

type HandoffSearchParams = {
  source?: string | string[];
  product?: string | string[];
  country?: string | string[];
  returnCompare?: string | string[];
};

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function activeProduct(productId: string | undefined) {
  if (!productId) return undefined;
  return PRODUCTS.find((product) => product.active && product.id === productId.trim());
}

function canonicalReturnComparison(raw: string | undefined): string[] {
  if (!raw) return [];
  const result: string[] = [];
  for (const candidate of raw.slice(0, 128).split(",")) {
    const country = findCountryByCode(candidate);
    if (!country || result.includes(country.code)) continue;
    result.push(country.code);
    if (result.length === 4) break;
  }
  return result.length >= 2 ? result : [];
}

/** Resolve only the narrow, registry-backed Market Intelligence handoff contract. */
export function resolveMarketIntelligenceBuyerFinderHandoff(
  searchParams: HandoffSearchParams | undefined,
): MarketIntelligenceBuyerFinderHandoff | null {
  if (one(searchParams?.source) !== MARKET_INTELLIGENCE_HANDOFF_SOURCE) return null;
  const product = activeProduct(one(searchParams?.product));
  const country = findCountryByCode(one(searchParams?.country));
  if (!product || !country) return null;
  return {
    source: MARKET_INTELLIGENCE_HANDOFF_SOURCE,
    productId: product.id,
    productName: product.displayName,
    countryAlpha2: country.code,
    countryName: country.name,
    returnComparison: canonicalReturnComparison(one(searchParams?.returnCompare)),
  };
}

export function buildBuyerFinderHandoffHref(input: {
  productId: string;
  countryAlpha2: string;
  returnComparison?: readonly string[];
}): string | null {
  const product = activeProduct(input.productId);
  const country = findCountryByCode(input.countryAlpha2);
  if (!product || !country) return null;
  const params = new URLSearchParams();
  params.set("product", product.id);
  params.set("country", country.code);
  params.set("source", MARKET_INTELLIGENCE_HANDOFF_SOURCE);
  const comparison = canonicalReturnComparison(input.returnComparison?.join(","));
  if (comparison.length >= 2) params.set(RETURN_COMPARISON_PARAM, comparison.join(","));
  return `/buyer-finder?${params.toString().replace(/%2C/gi, ",")}`;
}

/** Internal-only return target derived from validated identities; no open URL input. */
export function buildMarketIntelligenceReturnHref(
  handoff: MarketIntelligenceBuyerFinderHandoff,
): string {
  const params = new URLSearchParams();
  params.set("product", handoff.productId);
  params.set("country", handoff.countryAlpha2);
  if (handoff.returnComparison.length >= 2) {
    params.set("compare", handoff.returnComparison.join(","));
  }
  return `/market-intelligence?${params.toString().replace(/%2C/gi, ",")}`;
}
