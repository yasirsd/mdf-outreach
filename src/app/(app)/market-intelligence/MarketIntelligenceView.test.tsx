import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ComponentSummary,
  CountryOverviewRow,
  MarketIntelligenceDetail,
  MarketIntelligenceOverview,
} from "@/lib/marketIntelligence/read/overview";
import { MarketIntelligenceView } from "./MarketIntelligenceView";

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => new URLSearchParams("product=guntur-dry-red-chilli&country=US"),
}));

afterEach(() => {
  cleanup();
  routerPush.mockReset();
});

const componentKeys: ComponentSummary["key"][] = [
  "demand_size",
  "demand_growth",
  "india_position",
  "competitive_opportunity",
  "price_attractiveness",
  "demand_stability",
];
const weights = [25, 20, 20, 15, 10, 10];
const components: ComponentSummary[] = componentKeys.map((key, index) => ({
  key,
  normalizedScore: 50 + index,
  weight: weights[index]!,
  supported: true,
}));

function market(countryAlpha2: string, countryName: string, fit: number): CountryOverviewRow {
  return {
    countryAlpha2,
    countryName,
    currentScoreId: `score-${countryAlpha2}`,
    marketFit: fit,
    dataConfidence: 90,
    recommendationStatus: "indicative",
    isTradeProxy: true,
    mappingKind: "proxy",
    fitEligibility: "proxy_allowed",
    latestImportValueUsd: 20_000_000,
    latestImportQuantityTonnes: 2_000,
    indiaImportValueUsd: 8_000_000,
    indiaShare: 0.4,
    indiaRank: 2,
    yoyPct: 5,
    cagr3Pct: 4,
    cagr5Pct: 3,
    derivedUnitValueUsdPerKg: 10,
    hhi: 0.3,
    top1Share: 0.5,
    top3Share: 0.9,
    components,
    calculatedAt: "2026-09-23T00:00:00.000Z",
  };
}

const us = market("US", "United States", 66);
const th = market("TH", "Thailand", 62);

const overview: MarketIntelligenceOverview = {
  version: "mi2a-overview-v1",
  product: { id: "guntur-dry-red-chilli", displayName: "Guntur Dry Red Chilli", shortName: "Chilli" },
  productSupported: true,
  isTradeProxyOnly: true,
  hsRevision: "HS17",
  hsCode: "090421",
  marketFitVersion: "mi-fit-v2",
  dataConfidenceVersion: "mi-conf-v1",
  totalMarkets: 2,
  latestEvidenceYear: 2024,
  latestScoreCalculatedAt: "2026-09-23T00:00:00.000Z",
  markets: [us, th],
};

const detail: MarketIntelligenceDetail = {
  version: "mi2a-overview-v1",
  product: overview.product,
  country: { alpha2: "US", name: "United States" },
  hsRevision: "HS17",
  hsCode: "090421",
  isTradeProxy: true,
  overview: us,
  history: [
    { period: "2023", totalUsd: 18_000_000, totalTonnes: 1_900, indiaValueUsd: 7_000_000, indiaShare: 7 / 18 },
    { period: "2024", totalUsd: 20_000_000, totalTonnes: 2_000, indiaValueUsd: 8_000_000, indiaShare: 0.4 },
  ],
  originsLatestYear: [
    { partnerCountry: "CN", partnerCountryName: "China", valueUsd: 12_000_000, share: 0.6 },
    { partnerCountry: "IN", partnerCountryName: "India", valueUsd: 8_000_000, share: 0.4 },
  ],
  latestPeriod: "2024",
  coverageStart: "2023",
  coverageEnd: "2024",
  provenance: {
    providerId: "baci_oec",
    datasetId: "baci-hs17",
    hsRevision: "HS17",
    hsCode: "090421",
    mappingKind: "proxy",
    mappingConfidence: 0.7,
    fitEligibility: "proxy_allowed",
    hasEvidenceWatermark: true,
    hasMappingWatermark: true,
  },
};

const products = [
  { id: "guntur-dry-red-chilli", displayName: "Guntur Dry Red Chilli", shortName: "Chilli" },
  { id: "banganapalli-mango", displayName: "Banganapalli Mango", shortName: "Mango" },
];

describe("MI2B Market Intelligence view", () => {
  it("renders persisted charts, exactly six weighted components, and the proxy disclosure", () => {
    render(
      <MarketIntelligenceView
        products={products}
        selectedProductId="guntur-dry-red-chilli"
        overview={overview}
        selectedDetail={detail}
      />,
    );
    expect(screen.getByText("Import demand", { selector: "h4" })).toBeTruthy();
    expect(screen.getByText("India share", { selector: "h4" })).toBeTruthy();
    expect(screen.getByText("Origin competition")).toBeTruthy();
    expect(screen.getByText("Demand size")).toBeTruthy();
    expect(screen.getByText("weight 25")).toBeTruthy();
    expect(screen.getAllByText(/weight \d+/)).toHaveLength(6);
    expect(screen.getByText(/does not prove imports specifically originated from Guntur/)).toBeTruthy();
    expect(screen.queryByText(/Excellent|Poor|Strong|Weak/)).toBeNull();
  });

  it("optimistically selects a country, keeps detail visible, exposes busy state, and blocks repeats", () => {
    const { container } = render(
      <MarketIntelligenceView
        products={products}
        selectedProductId="guntur-dry-red-chilli"
        overview={overview}
        selectedDetail={detail}
      />,
    );
    const thailand = screen.getByRole("button", { name: /Thailand/ });
    fireEvent.click(thailand);
    expect(routerPush).toHaveBeenCalledWith(
      "/market-intelligence?product=guntur-dry-red-chilli&country=TH",
      { scroll: false },
    );
    expect(thailand.getAttribute("aria-busy")).toBe("true");
    expect(thailand.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("aside")?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("United States", { selector: "h3" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /United States/ }));
    expect(routerPush).toHaveBeenCalledTimes(1);
  });

  it("keeps product navigation canonical and disables repeat transitions", () => {
    render(
      <MarketIntelligenceView
        products={products}
        selectedProductId="guntur-dry-red-chilli"
        overview={overview}
        selectedDetail={detail}
      />,
    );
    const selector = screen.getByLabelText("Product") as HTMLSelectElement;
    fireEvent.change(selector, { target: { value: "banganapalli-mango" } });
    expect(routerPush).toHaveBeenCalledWith(
      "/market-intelligence?product=banganapalli-mango",
      { scroll: false },
    );
    expect(selector.disabled).toBe(true);
    expect(selector.parentElement?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Loading product")).toBeTruthy();
  });
});
