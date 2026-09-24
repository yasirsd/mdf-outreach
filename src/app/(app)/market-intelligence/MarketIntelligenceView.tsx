"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Info } from "lucide-react";
import { PageContainer } from "@/components/ui/Page";
import {
  formatPercent,
  formatPercentValue,
  formatRank,
  formatScoreOutOf100,
  formatTonnes,
  formatUsdCompact,
  formatUsdPerKg,
  MI2A_EM_DASH,
} from "@/lib/marketIntelligence/format";
import type {
  CountryOverviewRow,
  MarketIntelligenceDetail,
  MarketIntelligenceOverview,
} from "@/lib/marketIntelligence/read/overview";

interface Props {
  products: Array<{ id: string; displayName: string; shortName: string }>;
  selectedProductId: string | null;
  overview: MarketIntelligenceOverview | undefined;
  selectedDetail: MarketIntelligenceDetail | undefined;
  /** MI2A.1 — explicit invalid ?product=… supplied by the URL. */
  invalidProduct?: boolean;
  requestedProductId?: string | null;
}

const RECOMMENDATION_COPY: Record<string, { label: string; help: string }> = {
  actionable: {
    label: "Actionable",
    help: "Publishable as a market recommendation. Exact classification, strong confidence.",
  },
  indicative: {
    label: "Indicative",
    help: "A market signal — useful for prioritisation, not a market claim. Guntur Dry Red Chilli uses HS 090421 trade data as a proxy.",
  },
  insufficient_evidence: {
    label: "Insufficient evidence",
    help: "Not enough evidence to publish a numeric Market Fit for this market.",
  },
};

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

const COMPONENT_LABELS: Record<string, string> = {
  demand_size: "Demand size",
  demand_growth: "Demand growth",
  india_position: "India position",
  competitive_opportunity: "Competitive opportunity",
  price_attractiveness: "Price attractiveness",
  demand_stability: "Demand stability",
};

export function MarketIntelligenceView({
  products, selectedProductId, overview, selectedDetail,
  invalidProduct = false, requestedProductId = null,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedCountry = selectedDetail?.country.alpha2 ?? overview?.markets[0]?.countryAlpha2 ?? null;

  const fitValues = useMemo(
    () => (overview?.markets ?? [])
      .map((row) => row.marketFit)
      .filter((v): v is number => typeof v === "number"),
    [overview?.markets],
  );
  const bestFit = fitValues.length > 0 ? Math.max(...fitValues) : null;
  const medianFit = medianOf(fitValues);

  const onProductChange = (productId: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("product", productId);
    params.delete("country");
    router.push(`/market-intelligence?${params.toString()}`);
  };
  const onCountrySelect = (countryAlpha2: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (selectedProductId) params.set("product", selectedProductId);
    params.set("country", countryAlpha2);
    router.push(`/market-intelligence?${params.toString()}`);
  };

  return (
    <PageContainer size="wide">
      <header className="mb-5">
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange mb-2 font-medium">
          Market Intelligence
        </div>
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-tight text-text-primary">
              Where does this product have export demand?
            </h1>
            <p className="mt-1.5 text-[13.5px] text-text-secondary max-w-2xl">
              Compare export-market demand using verified trade evidence. Two numbers travel
              together: <span className="text-text-primary">Market Fit</span> tells you how
              attractive the market looks, and{" "}
              <span className="text-text-primary">Data Confidence</span> tells you how much of
              that signal is grounded in evidence.
            </p>
          </div>
          <ProductSelector
            products={products}
            selectedProductId={selectedProductId}
            onChange={onProductChange}
          />
        </div>
      </header>

      <SummaryStrip
        overview={overview}
        bestFit={bestFit}
        medianFit={medianFit}
      />

      {invalidProduct ? (
        <InvalidProductState requestedProductId={requestedProductId} />
      ) : !overview || !overview.productSupported ? (
        <UnavailableState overview={overview} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-4 items-start">
          <RankingTable
            rows={overview.markets}
            selectedCountry={selectedCountry}
            onSelect={onCountrySelect}
            hsRevision={overview.hsRevision}
            hsCode={overview.hsCode}
            isTradeProxy={overview.isTradeProxyOnly}
          />
          <DetailPanel detail={selectedDetail} />
        </div>
      )}

      {overview?.isTradeProxyOnly && (
        <ProxyDisclosure hsRevision={overview.hsRevision} hsCode={overview.hsCode} />
      )}
    </PageContainer>
  );
}

function ProductSelector({
  products, selectedProductId, onChange,
}: {
  products: Array<{ id: string; displayName: string; shortName: string }>;
  selectedProductId: string | null;
  onChange: (productId: string) => void;
}) {
  if (products.length === 0) return null;
  return (
    <div className="shrink-0">
      <label htmlFor="mi-product-select" className="sr-only">Product</label>
      <select
        id="mi-product-select"
        value={selectedProductId ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-[220px] text-[13px] py-1.5 px-2.5 rounded-[8px] focus-ring"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px solid var(--app-border)",
          color: "var(--text-primary)",
        }}
      >
        {products.map((product) => (
          <option key={product.id} value={product.id}>{product.displayName}</option>
        ))}
      </select>
    </div>
  );
}

function SummaryStrip({
  overview, bestFit, medianFit,
}: {
  overview: MarketIntelligenceOverview | undefined;
  bestFit: number | null;
  medianFit: number | null;
}) {
  return (
    <div
      className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 rounded-[12px] p-3.5"
      style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}
    >
      <SummaryStat label="Markets analysed" value={overview ? String(overview.totalMarkets) : MI2A_EM_DASH} />
      <SummaryStat
        label="Best persisted Fit"
        value={typeof bestFit === "number" ? formatScoreOutOf100(bestFit) : MI2A_EM_DASH}
      />
      <SummaryStat
        label="Median Fit"
        value={typeof medianFit === "number" ? formatScoreOutOf100(medianFit) : MI2A_EM_DASH}
      />
      <SummaryStat
        label="Latest evidence year"
        value={overview?.latestEvidenceYear !== null && overview?.latestEvidenceYear !== undefined
          ? String(overview.latestEvidenceYear)
          : MI2A_EM_DASH}
        secondary={overview ? `${overview.marketFitVersion} · ${overview.dataConfidenceVersion}` : undefined}
      />
    </div>
  );
}

function SummaryStat({
  label, value, secondary,
}: { label: string; value: string; secondary?: string }) {
  return (
    <div>
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted">{label}</div>
      <div className="mt-1 text-[18px] font-semibold text-text-primary tabular-nums leading-tight">
        {value}
      </div>
      {secondary && (
        <div className="mt-0.5 text-[10.5px] text-text-muted">{secondary}</div>
      )}
    </div>
  );
}

function UnavailableState({ overview }: { overview: MarketIntelligenceOverview | undefined }) {
  return (
    <div
      className="rounded-[16px] p-8"
      style={{ backgroundColor: "var(--app-surface)", border: "1px dashed var(--app-border-strong)" }}
    >
      <div className="max-w-2xl">
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-text-muted mb-2 font-medium">
          Evidence not ready
        </div>
        <h2 className="text-[18px] font-semibold text-text-primary tracking-tight">
          {overview?.product
            ? `Market Intelligence is not available for ${overview.product.displayName} yet.`
            : "No Market Intelligence data is available."}
        </h2>
        <p className="mt-2 text-[13px] text-text-secondary leading-relaxed">
          Only products whose calibration cohort has been materialised appear here with real
          numbers. Guntur Dry Red Chilli is the first product with production Market Fit.
          Additional products will show up here once their calibration completes — nothing is
          fabricated in the meantime.
        </p>
      </div>
    </div>
  );
}

function InvalidProductState({ requestedProductId }: { requestedProductId: string | null }) {
  // MI2A.1 — an explicit /market-intelligence?product=<invalid> MUST NOT
  // silently render another product's data. This card carries no market
  // signal at all — no ranking, no fit, no confidence, no proxy figures.
  return (
    <div
      className="rounded-[16px] p-8"
      style={{ backgroundColor: "var(--app-surface)", border: "1px dashed var(--app-border-strong)" }}
    >
      <div className="max-w-2xl">
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-text-muted mb-2 font-medium">
          Unknown product
        </div>
        <h2 className="text-[18px] font-semibold text-text-primary tracking-tight">
          &quot;{requestedProductId ?? ""}&quot; is not a recognised MDF product.
        </h2>
        <p className="mt-2 text-[13px] text-text-secondary leading-relaxed">
          Choose a product from the selector to view its Market Intelligence, or open
          Market Intelligence without a product parameter to see the default.
        </p>
      </div>
    </div>
  );
}

function RankingTable({
  rows, selectedCountry, onSelect, hsRevision, hsCode, isTradeProxy,
}: {
  rows: CountryOverviewRow[];
  selectedCountry: string | null;
  onSelect: (countryAlpha2: string) => void;
  hsRevision: string | null;
  hsCode: string | null;
  isTradeProxy: boolean;
}) {
  return (
    <section
      aria-labelledby="mi-ranking-heading"
      className="rounded-[12px]"
      style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}
    >
      <div className="flex items-baseline justify-between px-5 pt-4 pb-3">
        <div>
          <h2 id="mi-ranking-heading" className="text-[13px] font-semibold text-text-primary">
            Country ranking
          </h2>
          <p className="mt-0.5 text-[11.5px] text-text-muted">
            Sorted by Market Fit
            {isTradeProxy && hsRevision && hsCode ? ` · Trade proxy — ${hsRevision} ${hsCode}` : ""}
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] text-text-secondary" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted">
              <th scope="col" className="text-left font-medium py-2 pl-5 pr-2">Rank</th>
              <th scope="col" className="text-left font-medium py-2 px-2">Market</th>
              <th scope="col" className="text-right font-medium py-2 px-2">Fit</th>
              <th scope="col" className="text-right font-medium py-2 px-2">Confidence</th>
              <th scope="col" className="text-right font-medium py-2 px-2">Demand</th>
              <th scope="col" className="text-right font-medium py-2 px-2">Growth</th>
              <th scope="col" className="text-right font-medium py-2 px-2">India share</th>
              <th scope="col" className="text-right font-medium py-2 px-2">India rank</th>
              <th scope="col" className="text-left font-medium py-2 px-2 pr-5">Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const active = row.countryAlpha2 === selectedCountry;
              return (
                <tr
                  key={row.countryAlpha2}
                  className="border-t focus-within:bg-white/[0.04]"
                  style={{ borderColor: "var(--app-border)" }}
                >
                  <td className="pl-5 pr-2 py-2 tabular-nums text-text-muted">{index + 1}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onSelect(row.countryAlpha2)}
                      aria-pressed={active}
                      className="text-left focus-ring-quiet rounded-[6px] px-1 -mx-1"
                      style={{
                        color: active ? "var(--text-primary)" : "var(--text-secondary)",
                        fontWeight: active ? 600 : 500,
                      }}
                    >
                      {row.countryName}{" "}
                      <span className="text-text-muted text-[11px] font-normal">
                        {row.countryAlpha2}
                      </span>
                    </button>
                  </td>
                  <td className="px-2 py-2 tabular-nums text-right text-text-primary font-medium">
                    {formatScoreOutOf100(row.marketFit)}
                  </td>
                  <td className="px-2 py-2 tabular-nums text-right">
                    {formatScoreOutOf100(row.dataConfidence)}
                  </td>
                  <td className="px-2 py-2 tabular-nums text-right">
                    {formatUsdCompact(row.latestImportValueUsd)}
                  </td>
                  <td className="px-2 py-2 tabular-nums text-right">
                    {formatPercentValue(row.cagr3Pct ?? row.cagr5Pct ?? row.yoyPct)}
                  </td>
                  <td className="px-2 py-2 tabular-nums text-right">
                    {formatPercent(row.indiaShare)}
                  </td>
                  <td className="px-2 py-2 tabular-nums text-right">
                    {formatRank(row.indiaRank)}
                  </td>
                  <td className="pl-2 pr-5 py-2">
                    <span
                      className="inline-block rounded-[6px] px-1.5 py-0.5 text-[10.5px]"
                      style={{
                        color: "var(--text-primary)",
                        border: "1px solid var(--app-border-strong)",
                        backgroundColor: "var(--app-elevated)",
                      }}
                    >
                      {RECOMMENDATION_COPY[row.recommendationStatus]?.label ?? row.recommendationStatus}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DetailPanel({ detail }: { detail: MarketIntelligenceDetail | undefined }) {
  if (!detail) {
    return (
      <aside
        className="rounded-[12px] p-5"
        style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}
      >
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted">
          Country detail
        </div>
        <p className="mt-2 text-[12.5px] text-text-secondary">
          Select a market on the left to see its Market Fit breakdown, six-component
          decomposition, trade history and provenance.
        </p>
      </aside>
    );
  }
  const recCopy = RECOMMENDATION_COPY[detail.overview.recommendationStatus];
  return (
    <aside
      className="rounded-[12px] p-5 flex flex-col gap-4"
      style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}
    >
      <div>
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted">
          {detail.country.alpha2}
        </div>
        <h3 className="mt-1 text-[18px] font-semibold text-text-primary tracking-tight">
          {detail.country.name}
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatBlock
          label="Market Fit"
          value={formatScoreOutOf100(detail.overview.marketFit)}
          help="Weighted 0..100 signal, mi-fit-v2."
        />
        <StatBlock
          label="Data Confidence"
          value={formatScoreOutOf100(detail.overview.dataConfidence)}
          help="Coverage / recency / mapping specificity. mi-conf-v1."
        />
      </div>

      <div
        className="rounded-[8px] p-3 flex items-start gap-2"
        style={{ backgroundColor: "var(--app-elevated)", border: "1px solid var(--app-border)" }}
      >
        <Info size={13} className="mt-[3px] text-text-muted shrink-0" aria-hidden />
        <div className="text-[11.5px] text-text-secondary">
          <span className="text-text-primary font-medium">Recommendation: {recCopy?.label ?? detail.overview.recommendationStatus}.</span>{" "}
          {recCopy?.help}
        </div>
      </div>

      <div>
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted mb-2">
          Score components
        </div>
        <ul className="flex flex-col gap-1.5">
          {detail.overview.components.map((component) => (
            <li key={component.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3">
              <span className="text-[12px] text-text-secondary truncate">
                {COMPONENT_LABELS[component.key] ?? component.key}
              </span>
              <span className="text-[10.5px] text-text-muted tabular-nums">w {component.weight}</span>
              <span className="text-[12px] tabular-nums text-text-primary">
                {formatScoreOutOf100(component.normalizedScore)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted mb-2">
          Latest year — {detail.latestPeriod ?? MI2A_EM_DASH}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-[12px]">
          <DetailStat label="Total imports" value={formatUsdCompact(detail.overview.latestImportValueUsd)} />
          <DetailStat label="Quantity" value={formatTonnes(detail.overview.latestImportQuantityTonnes)} />
          <DetailStat label="India imports" value={formatUsdCompact(detail.overview.indiaImportValueUsd)} />
          <DetailStat label="India share" value={formatPercent(detail.overview.indiaShare)} />
          <DetailStat label="India rank" value={formatRank(detail.overview.indiaRank)} />
          <DetailStat label="Top-1 share" value={formatPercent(detail.overview.top1Share)} />
          <DetailStat label="Top-3 share" value={formatPercent(detail.overview.top3Share)} />
          <DetailStat label="HHI" value={detail.overview.hhi === null ? MI2A_EM_DASH : detail.overview.hhi.toFixed(3)} />
          <DetailStat label="Unit value" value={formatUsdPerKg(detail.overview.derivedUnitValueUsdPerKg)} />
          <DetailStat label="3y CAGR" value={formatPercentValue(detail.overview.cagr3Pct)} />
        </dl>
      </div>

      {detail.originsLatestYear.length > 0 && (
        <div>
          <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted mb-2">
            Top origin partners
          </div>
          <ol className="flex flex-col gap-1">
            {detail.originsLatestYear.slice(0, 5).map((origin, idx) => (
              <li key={origin.partnerCountry} className="flex items-baseline justify-between text-[12px]">
                <span className="text-text-secondary">
                  <span className="text-text-muted tabular-nums w-4 inline-block">{idx + 1}.</span>{" "}
                  {origin.partnerCountryName ?? origin.partnerCountry}{" "}
                  <span className="text-text-muted text-[11px]">{origin.partnerCountry}</span>
                </span>
                <span className="text-text-primary tabular-nums">
                  {formatUsdCompact(origin.valueUsd)}{" "}
                  <span className="text-text-muted text-[11px]">{formatPercent(origin.share)}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <ProvenanceBlock detail={detail} />
    </aside>
  );
}

function StatBlock({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div
      className="rounded-[8px] p-3"
      style={{ backgroundColor: "var(--app-elevated)", border: "1px solid var(--app-border)" }}
    >
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted">{label}</div>
      <div className="mt-1 text-[18px] font-semibold text-text-primary tabular-nums leading-tight">
        {value}
      </div>
      <div className="mt-1 text-[10.5px] text-text-muted">{help}</div>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10.5px] text-text-muted">{label}</dt>
      <dd className="mt-0.5 tabular-nums text-text-primary">{value}</dd>
    </div>
  );
}

function ProvenanceBlock({ detail }: { detail: MarketIntelligenceDetail }) {
  return (
    <div
      className="rounded-[8px] p-3"
      style={{ backgroundColor: "var(--app-elevated)", border: "1px solid var(--app-border)" }}
    >
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted mb-1.5">
        Evidence
      </div>
      <dl className="text-[11.5px] text-text-secondary grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-text-muted">Source</dt>
        <dd>CEPII BACI HS2017 · via OEC BotMarket</dd>
        <dt className="text-text-muted">Trade code</dt>
        <dd>{detail.provenance.hsRevision ?? MI2A_EM_DASH} {detail.provenance.hsCode ?? ""}</dd>
        <dt className="text-text-muted">Mapping</dt>
        <dd>
          {detail.provenance.mappingKind === "proxy"
            ? "Trade proxy"
            : detail.provenance.mappingKind === "exact"
              ? "Exact"
              : "Composite"}
        </dd>
        <dt className="text-text-muted">Coverage</dt>
        <dd>
          {detail.coverageStart && detail.coverageEnd
            ? `${detail.coverageStart}–${detail.coverageEnd}`
            : MI2A_EM_DASH}
        </dd>
        <dt className="text-text-muted">Latest year</dt>
        <dd>{detail.latestPeriod ?? MI2A_EM_DASH}</dd>
      </dl>
    </div>
  );
}

function ProxyDisclosure({ hsRevision, hsCode }: { hsRevision: string | null; hsCode: string | null }) {
  return (
    <div
      className="mt-5 rounded-[12px] p-4 flex items-start gap-3"
      style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}
    >
      <Info size={14} className="mt-[3px] text-text-muted shrink-0" aria-hidden />
      <div className="text-[12px] text-text-secondary leading-relaxed">
        <span className="text-text-primary font-medium">Trade proxy — {hsRevision} {hsCode}.</span>{" "}
        Trade data represents dried chilli under HS 090421 at market level and is used as a
        proxy for demand. It does not prove imports specifically originated from Guntur, and
        it is not company-level evidence. Buyer Intelligence — coming later — will link
        specific companies to specific shipments where evidence exists. Full methodology:{" "}
        <Link href="/settings" className="text-brand-orange hover:underline focus-ring-quiet">
          settings
        </Link>.
      </div>
    </div>
  );
}
