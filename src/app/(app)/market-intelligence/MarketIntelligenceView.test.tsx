import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ComponentSummary,
  CountryOverviewRow,
  MarketIntelligenceComparison,
  MarketIntelligenceDetail,
  MarketIntelligenceOverview,
} from "@/lib/marketIntelligence/read/overview";
import { MarketIntelligenceView } from "./MarketIntelligenceView";

const routerPush = vi.hoisted(() => vi.fn());
const searchState = vi.hoisted(() => ({ value: "product=guntur-dry-red-chilli&country=US" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => new URLSearchParams(searchState.value),
}));

afterEach(() => {
  cleanup();
  routerPush.mockReset();
  searchState.value = "product=guntur-dry-red-chilli&country=US";
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

const thailandDetail: MarketIntelligenceDetail = {
  ...detail,
  country: { alpha2: "TH", name: "Thailand" },
  overview: th,
  history: detail.history.map((point) => ({ ...point, totalUsd: (point.totalUsd ?? 0) * 0.7 })),
};

const comparison: MarketIntelligenceComparison = {
  product: overview.product,
  marketFitVersion: "mi-fit-v2",
  dataConfidenceVersion: "mi-conf-v1",
  countryAlpha2s: ["US", "TH"],
  countries: [detail, thailandDetail],
};

const products = [
  { id: "guntur-dry-red-chilli", displayName: "Guntur Dry Red Chilli", shortName: "Chilli" },
  { id: "banganapalli-mango", displayName: "Banganapalli Mango", shortName: "Mango" },
];

describe("MI2B Market Intelligence view", () => {
  it("exposes a canonical country-detail Buyer Finder handoff with identity only", () => {
    render(
      <MarketIntelligenceView products={products} selectedProductId="guntur-dry-red-chilli" overview={overview} selectedDetail={detail} comparison={undefined} />,
    );
    const link = screen.getByRole("link", { name: "Find buyers in United States" });
    expect(link.getAttribute("href")).toBe(
      "/buyer-finder?product=guntur-dry-red-chilli&country=US&source=market-intelligence",
    );
    expect(link.getAttribute("href")).not.toMatch(/provider|090421|fit=|confidence=/i);
  });

  it("renders persisted charts, exactly six weighted components, and the proxy disclosure", () => {
    render(
      <MarketIntelligenceView
        products={products}
        selectedProductId="guntur-dry-red-chilli"
        overview={overview}
        selectedDetail={detail}
        comparison={undefined}
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
        comparison={undefined}
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
        comparison={undefined}
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

  it("clears country and comparison state when the product changes", () => {
    searchState.value = "product=guntur-dry-red-chilli&country=US&compare=US,TH";
    render(
      <MarketIntelligenceView products={products} selectedProductId="guntur-dry-red-chilli" overview={overview} selectedDetail={detail} comparison={comparison} />,
    );
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "banganapalli-mango" } });
    expect(routerPush).toHaveBeenCalledWith(
      "/market-intelligence?product=banganapalli-mango",
      { scroll: false },
    );
  });

  it("opens a refresh-safe two-country deep link with a complete comparison surface", () => {
    render(
      <MarketIntelligenceView
        products={products}
        selectedProductId="guntur-dry-red-chilli"
        overview={overview}
        selectedDetail={detail}
        comparison={comparison}
      />,
    );
    expect(screen.getByRole("heading", { name: /Persisted market evidence across 2 countries/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Metric comparison" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Six-component matrix" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Competitive structure" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Evidence and provenance" })).toBeTruthy();
    expect(screen.getByLabelText("Import demand over time")).toBeTruthy();
    expect(screen.getByLabelText("India share over time")).toBeTruthy();
    expect(screen.queryByText(/winner|best market|excellent/i)).toBeNull();
    const usLinks = screen.getAllByRole("link", { name: "Find buyers in United States" });
    const thLink = screen.getByRole("link", { name: "Find buyers in Thailand" });
    expect(usLinks.some((link) => link.getAttribute("href")?.includes("country=US"))).toBe(true);
    expect(thLink.getAttribute("href")).toContain("country=TH");
    expect(thLink.getAttribute("href")).toContain("returnCompare=US,TH");
    expect(screen.queryByRole("link", { name: /all 2 markets/i })).toBeNull();
  });

  it("keeps one selected market out of comparison mode and exposes the select-one-more state", () => {
    render(
      <MarketIntelligenceView
        products={products}
        selectedProductId="guntur-dry-red-chilli"
        overview={overview}
        selectedDetail={detail}
        comparison={{ ...comparison, countryAlpha2s: ["US"], countries: [detail] }}
      />,
    );
    expect((screen.getByRole("button", { name: "Select 1 more market" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("heading", { name: /Persisted market evidence/ })).toBeNull();
  });

  it("does not enter comparison automatically when a second selection resolves; CTA retains user agency", () => {
    const one = { ...comparison, countryAlpha2s: ["US"], countries: [detail] };
    const { rerender } = render(
      <MarketIntelligenceView products={products} selectedProductId="guntur-dry-red-chilli" overview={overview} selectedDetail={detail} comparison={one} />,
    );
    rerender(
      <MarketIntelligenceView products={products} selectedProductId="guntur-dry-red-chilli" overview={overview} selectedDetail={detail} comparison={comparison} />,
    );
    expect(screen.queryByRole("heading", { name: /Persisted market evidence/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Compare 2 markets" }));
    expect(screen.getByRole("heading", { name: /Persisted market evidence across 2 countries/ })).toBeTruthy();
  });

  it("caps selection at four and allows removal through an accessible chip control", () => {
    const my = market("MY", "Malaysia", 57);
    const ae = market("AE", "United Arab Emirates", 36);
    const jp = market("JP", "Japan", 43);
    const expandedOverview = { ...overview, totalMarkets: 5, markets: [us, th, my, jp, ae] };
    const makeDetail = (row: CountryOverviewRow): MarketIntelligenceDetail => ({
      ...detail,
      country: { alpha2: row.countryAlpha2, name: row.countryName },
      overview: row,
    });
    const four = {
      ...comparison,
      countryAlpha2s: ["US", "TH", "MY", "AE"],
      countries: [us, th, my, ae].map(makeDetail),
    };
    render(
      <MarketIntelligenceView products={products} selectedProductId="guntur-dry-red-chilli" overview={expandedOverview} selectedDetail={detail} comparison={four} />,
    );
    expect((screen.getByRole("checkbox", { name: "Add Japan to comparison" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Compare 4 markets" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove United States from comparison" }));
    expect(routerPush).toHaveBeenCalledWith(
      "/market-intelligence?product=guntur-dry-red-chilli&country=US&compare=TH,MY,AE",
      { scroll: false },
    );
    expect(screen.getByRole("heading", { name: /Persisted market evidence across 4 countries/ })).toBeTruthy();
  });

  it("uses a distinct checkbox control and writes canonical comparison URL state", () => {
    render(
      <MarketIntelligenceView
        products={products}
        selectedProductId="guntur-dry-red-chilli"
        overview={overview}
        selectedDetail={detail}
        comparison={undefined}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Add Thailand to comparison" }));
    expect(routerPush).toHaveBeenCalledWith(
      "/market-intelligence?product=guntur-dry-red-chilli&country=US&compare=TH",
      { scroll: false },
    );
    const thailandRowButton = screen.getAllByRole("button", { name: /Thailand/ })
      .find((button) => button.hasAttribute("aria-pressed"));
    expect(thailandRowButton?.getAttribute("aria-pressed")).toBe("false");
  });

  it("does not expose comparison controls for an unsupported product", () => {
    render(
      <MarketIntelligenceView
        products={products}
        selectedProductId="banganapalli-mango"
        overview={{
          ...overview,
          product: { id: "banganapalli-mango", displayName: "Banganapalli Mango", shortName: "Mango" },
          productSupported: false,
          totalMarkets: 0,
          markets: [],
        }}
        selectedDetail={undefined}
        comparison={undefined}
      />,
    );
    expect(screen.queryByLabelText("Market comparison selection")).toBeNull();
    expect(screen.queryByRole("link", { name: /Find buyers in/i })).toBeNull();
    expect(screen.getByText(/Market Intelligence is not available for Banganapalli Mango yet/)).toBeTruthy();
    expect(screen.queryByText(/calibration cohort/i)).toBeNull();
  });
});
