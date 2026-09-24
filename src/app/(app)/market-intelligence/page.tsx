import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { requireMdfSession } from "@/lib/auth/require";
import { createMarketReadRepository } from "@/lib/marketIntelligence/marketReadRepository";
import {
  getMarketIntelligenceDetail,
  getMarketIntelligenceOverview,
  marketIntelligenceProducts,
  resolveMarketIntelligenceProductRouting,
} from "@/lib/marketIntelligence/read/overview";
import { MarketIntelligenceView } from "./MarketIntelligenceView";

export const dynamic = "force-dynamic";

const DEFAULT_PRODUCT_ID = "guntur-dry-red-chilli";

export default async function MarketIntelligencePage({
  searchParams,
}: {
  searchParams?: { product?: string; country?: string };
}) {
  // Auth boundary: `requireMdfSession()` enforces the same authenticated
  // (app) shell/session gate every other /(app) page inherits — see
  // src/app/(app)/layout.tsx and src/lib/repositories/server.ts. An
  // unauthenticated visitor is redirected before this component renders.
  await requireMdfSession();

  const products = marketIntelligenceProducts();
  const requestedProductRaw = searchParams?.product;
  const requestedProductId = typeof requestedProductRaw === "string"
    ? requestedProductRaw
    : undefined;

  // MI2A.1 product routing contract, delegated to the pure helper:
  //   default  → guntur-dry-red-chilli
  //   valid    → the requested product
  //   invalid  → NO product; render the invalid state (do NOT silently
  //              fall back to chilli data)
  const routing = resolveMarketIntelligenceProductRouting(
    requestedProductId,
    DEFAULT_PRODUCT_ID,
  );
  const product = routing.product;
  const invalidProduct = routing.kind === "invalid";

  const productList = products.map((p) => ({
    id: p.id, displayName: p.displayName, shortName: p.shortName,
  }));

  if (invalidProduct) {
    return (
      <MarketIntelligenceView
        products={productList}
        selectedProductId={null}
        overview={undefined}
        selectedDetail={undefined}
        invalidProduct
        requestedProductId={routing.requestedProductId}
      />
    );
  }
  if (!product) {
    return (
      <MarketIntelligenceView
        products={productList}
        selectedProductId={null}
        overview={undefined}
        selectedDetail={undefined}
      />
    );
  }

  const supabase = createClient(cookies());
  const repository = createMarketReadRepository(supabase);
  const overview = await getMarketIntelligenceOverview(product.id, repository);

  const requestedCountryRaw = searchParams?.country;
  const requestedCountry =
    typeof requestedCountryRaw === "string" && /^[A-Za-z]{2}$/.test(requestedCountryRaw.trim())
      ? requestedCountryRaw.trim().toUpperCase()
      : undefined;
  const defaultCountry = overview?.markets[0]?.countryAlpha2;
  const detailCountry = requestedCountry &&
      overview?.markets.some((row) => row.countryAlpha2 === requestedCountry)
    ? requestedCountry
    : defaultCountry;
  const selectedDetail = detailCountry
    ? await getMarketIntelligenceDetail(product.id, detailCountry, repository)
    : undefined;

  return (
    <MarketIntelligenceView
      products={productList}
      selectedProductId={product.id}
      overview={overview}
      selectedDetail={selectedDetail}
    />
  );
}
