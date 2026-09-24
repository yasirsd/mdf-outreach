"use client";

import { Info } from "lucide-react";
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
  ComponentSummary,
  MarketIntelligenceComparison,
  MarketIntelligenceDetail,
} from "@/lib/marketIntelligence/read/overview";
import { ComparisonTrendCharts } from "./MarketComparisonCharts";
import { BuyerFinderHandoffLink } from "./BuyerFinderHandoffLink";

const COMPONENT_LABELS: Record<ComponentSummary["key"], string> = {
  demand_size: "Demand size",
  demand_growth: "Demand growth",
  india_position: "India position",
  competitive_opportunity: "Competitive opportunity",
  price_attractiveness: "Price attractiveness",
  demand_stability: "Demand stability",
};

const COMPONENT_ORDER = Object.keys(COMPONENT_LABELS) as ComponentSummary["key"][];

function mappingLabel(kind: MarketIntelligenceDetail["provenance"]["mappingKind"]): string {
  if (kind === "proxy") return "Trade proxy";
  if (kind === "exact") return "Exact";
  return "Composite";
}

function MetricMatrix({ countries }: { countries: readonly MarketIntelligenceDetail[] }) {
  const metrics = [
    { label: "Market Fit", value: (c: MarketIntelligenceDetail) => formatScoreOutOf100(c.overview.marketFit) },
    { label: "Data Confidence", value: (c: MarketIntelligenceDetail) => formatScoreOutOf100(c.overview.dataConfidence) },
    { label: "Latest import demand", value: (c: MarketIntelligenceDetail) => formatUsdCompact(c.overview.latestImportValueUsd) },
    { label: "Latest import quantity", value: (c: MarketIntelligenceDetail) => formatTonnes(c.overview.latestImportQuantityTonnes) },
    { label: "India import value", value: (c: MarketIntelligenceDetail) => formatUsdCompact(c.overview.indiaImportValueUsd) },
    { label: "India share", value: (c: MarketIntelligenceDetail) => formatPercent(c.overview.indiaShare) },
    { label: "India rank", value: (c: MarketIntelligenceDetail) => formatRank(c.overview.indiaRank) },
    { label: "3y CAGR", value: (c: MarketIntelligenceDetail) => formatPercentValue(c.overview.cagr3Pct) },
    { label: "5y CAGR", value: (c: MarketIntelligenceDetail) => formatPercentValue(c.overview.cagr5Pct) },
    { label: "Latest YoY", value: (c: MarketIntelligenceDetail) => formatPercentValue(c.overview.yoyPct) },
    { label: "HHI", value: (c: MarketIntelligenceDetail) => c.overview.hhi === null ? MI2A_EM_DASH : c.overview.hhi.toFixed(3) },
    { label: "Top-1 share", value: (c: MarketIntelligenceDetail) => formatPercent(c.overview.top1Share) },
    { label: "Top-3 share", value: (c: MarketIntelligenceDetail) => formatPercent(c.overview.top3Share) },
    { label: "Derived unit value", value: (c: MarketIntelligenceDetail) => formatUsdPerKg(c.overview.derivedUnitValueUsdPerKg) },
    { label: "Recommendation", value: (c: MarketIntelligenceDetail) => c.overview.recommendationStatus.replaceAll("_", " ") },
  ];
  return (
    <section aria-labelledby="comparison-metrics-heading" className="rounded-[12px] overflow-hidden" style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}>
      <div className="px-4 sm:px-5 pt-4 pb-3">
        <h3 id="comparison-metrics-heading" className="text-[13px] font-semibold text-text-primary">Metric comparison</h3>
        <p className="mt-0.5 text-[10.5px] text-text-muted">Direct persisted values with consistent units</p>
      </div>
      <div className="overflow-x-auto focus-ring-quiet" tabIndex={0} aria-label="Scrollable market metric comparison">
        <table className="w-full min-w-[680px] text-[12px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="border-t text-[10.5px] uppercase tracking-[0.12em] text-text-muted" style={{ borderColor: "var(--app-border)" }}>
              <th scope="col" className="sticky left-0 z-[1] min-w-[170px] px-4 sm:px-5 py-2.5 text-left font-medium" style={{ backgroundColor: "var(--app-surface)" }}>Metric</th>
              {countries.map((country) => <th key={country.country.alpha2} scope="col" className="min-w-[138px] px-3 py-2.5 text-right font-medium"><span className="text-text-secondary normal-case tracking-normal">{country.country.name}</span><span className="ml-1 text-text-muted">{country.country.alpha2}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => (
              <tr key={metric.label} className="border-t" style={{ borderColor: "var(--app-border)" }}>
                <th scope="row" className="sticky left-0 z-[1] px-4 sm:px-5 py-2.5 text-left font-normal text-text-secondary" style={{ backgroundColor: "var(--app-surface)" }}>{metric.label}</th>
                {countries.map((country) => <td key={country.country.alpha2} className="px-3 py-2.5 text-right tabular-nums text-text-primary whitespace-nowrap capitalize">{metric.value(country)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComponentMatrix({ countries }: { countries: readonly MarketIntelligenceDetail[] }) {
  return (
    <section aria-labelledby="comparison-components-heading" className="rounded-[12px] overflow-hidden" style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}>
      <div className="px-4 sm:px-5 pt-4 pb-3">
        <h3 id="comparison-components-heading" className="text-[13px] font-semibold text-text-primary">Six-component matrix</h3>
        <p className="mt-0.5 text-[10.5px] text-text-muted">Persisted normalized score with component weight</p>
      </div>
      <div className="overflow-x-auto focus-ring-quiet" tabIndex={0} aria-label="Scrollable score component comparison">
        <table className="w-full min-w-[680px] text-[12px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="border-t text-[10.5px] uppercase tracking-[0.12em] text-text-muted" style={{ borderColor: "var(--app-border)" }}>
              <th scope="col" className="sticky left-0 z-[1] min-w-[190px] px-4 sm:px-5 py-2.5 text-left font-medium" style={{ backgroundColor: "var(--app-surface)" }}>Component</th>
              {countries.map((country) => <th key={country.country.alpha2} scope="col" className="min-w-[138px] px-3 py-2.5 text-right font-medium">{country.country.alpha2}</th>)}
            </tr>
          </thead>
          <tbody>
            {COMPONENT_ORDER.map((key) => (
              <tr key={key} className="border-t" style={{ borderColor: "var(--app-border)" }}>
                <th scope="row" className="sticky left-0 z-[1] px-4 sm:px-5 py-2.5 text-left font-normal text-text-secondary" style={{ backgroundColor: "var(--app-surface)" }}>{COMPONENT_LABELS[key]}</th>
                {countries.map((country) => {
                  const component = country.overview.components.find((item) => item.key === key);
                  return (
                    <td key={country.country.alpha2} className="px-3 py-2.5 text-right tabular-nums text-text-primary whitespace-nowrap">
                      {component ? formatScoreOutOf100(component.normalizedScore) : MI2A_EM_DASH}
                      {component && <span className="ml-1.5 text-[10px] text-text-muted">w{component.weight}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CompetitiveStructure({ countries }: { countries: readonly MarketIntelligenceDetail[] }) {
  return (
    <section aria-labelledby="comparison-competition-heading">
      <div className="mb-2.5">
        <h3 id="comparison-competition-heading" className="text-[13px] font-semibold text-text-primary">Competitive structure</h3>
        <p className="mt-0.5 text-[10.5px] text-text-muted">Latest persisted evidence year for each market</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-3">
        {countries.map((country) => (
          <article key={country.country.alpha2} className="rounded-[12px] p-4" style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}>
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-[12.5px] font-semibold text-text-primary">{country.country.name}</h4>
              <span className="text-[10.5px] text-text-muted">{country.latestPeriod ?? MI2A_EM_DASH}</span>
            </div>
            <div className="mt-2">
              <BuyerFinderHandoffLink
                productId={country.product.id}
                countryAlpha2={country.country.alpha2}
                countryName={country.country.name}
                returnComparison={countries.map((item) => item.country.alpha2)}
                compact
              />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2">
              <div><dt className="text-[10px] text-text-muted">Top-1</dt><dd className="mt-0.5 text-[11.5px] tabular-nums text-text-primary">{formatPercent(country.overview.top1Share)}</dd></div>
              <div><dt className="text-[10px] text-text-muted">Top-3</dt><dd className="mt-0.5 text-[11.5px] tabular-nums text-text-primary">{formatPercent(country.overview.top3Share)}</dd></div>
              <div><dt className="text-[10px] text-text-muted">HHI</dt><dd className="mt-0.5 text-[11.5px] tabular-nums text-text-primary">{country.overview.hhi === null ? MI2A_EM_DASH : country.overview.hhi.toFixed(3)}</dd></div>
              <div><dt className="text-[10px] text-text-muted">India</dt><dd className="mt-0.5 text-[11.5px] tabular-nums text-text-primary">{formatPercent(country.overview.indiaShare)}</dd></div>
              <div><dt className="text-[10px] text-text-muted">Rank</dt><dd className="mt-0.5 text-[11.5px] tabular-nums text-text-primary">{formatRank(country.overview.indiaRank)}</dd></div>
            </dl>
            <ol className="mt-3 space-y-1.5">
              {country.originsLatestYear.slice(0, 3).map((origin, index) => (
                <li key={origin.partnerCountry} className="flex items-center justify-between gap-2 text-[10.5px]">
                  <span className="truncate text-text-secondary">{index + 1}. {origin.partnerCountryName ?? origin.partnerCountry}</span>
                  <span className="shrink-0 tabular-nums text-text-primary">{formatPercent(origin.share)}</span>
                </li>
              ))}
              {country.originsLatestYear.length === 0 && <li className="text-[10.5px] text-text-muted">Not available</li>}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProvenanceMatrix({ countries }: { countries: readonly MarketIntelligenceDetail[] }) {
  return (
    <section aria-labelledby="comparison-provenance-heading" className="rounded-[12px] overflow-hidden" style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}>
      <div className="px-4 sm:px-5 pt-4 pb-3">
        <h3 id="comparison-provenance-heading" className="text-[13px] font-semibold text-text-primary">Evidence and provenance</h3>
      </div>
      <div className="overflow-x-auto focus-ring-quiet" tabIndex={0} aria-label="Scrollable market provenance comparison">
        <table className="w-full min-w-[760px] text-[11.5px]" style={{ borderCollapse: "collapse" }}>
          <thead><tr className="border-t text-[10px] uppercase tracking-[0.12em] text-text-muted" style={{ borderColor: "var(--app-border)" }}><th scope="col" className="px-4 sm:px-5 py-2.5 text-left font-medium">Market</th><th scope="col" className="px-3 py-2.5 text-left font-medium">Source</th><th scope="col" className="px-3 py-2.5 text-left font-medium">Trade code</th><th scope="col" className="px-3 py-2.5 text-left font-medium">Mapping</th><th scope="col" className="px-3 py-2.5 text-left font-medium">Coverage</th></tr></thead>
          <tbody>
            {countries.map((country) => (
              <tr key={country.country.alpha2} className="border-t text-text-secondary" style={{ borderColor: "var(--app-border)" }}>
                <th scope="row" className="px-4 sm:px-5 py-2.5 text-left font-medium text-text-primary">{country.country.name} <span className="text-text-muted">{country.country.alpha2}</span></th>
                <td className="px-3 py-2.5">CEPII BACI HS2017</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{country.provenance.hsRevision ?? MI2A_EM_DASH} {country.provenance.hsCode ?? ""}</td>
                <td className="px-3 py-2.5">{mappingLabel(country.provenance.mappingKind)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{country.coverageStart && country.coverageEnd ? `${country.coverageStart}–${country.coverageEnd}` : MI2A_EM_DASH}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MarketComparisonView({
  comparison,
}: {
  comparison: MarketIntelligenceComparison;
}) {
  const countries = comparison.countries;
  if (countries.length < 2) return null;
  return (
    <section aria-labelledby="market-comparison-heading" className="mb-5 space-y-4">
      <div>
        <div className="text-[10.5px] uppercase tracking-[0.15em] text-brand-orange font-medium">Side-by-side comparison</div>
        <h2 id="market-comparison-heading" className="mt-1 text-[19px] font-semibold tracking-tight text-text-primary">Persisted market evidence across {countries.length} countries</h2>
        <p className="mt-1 text-[11.5px] text-text-muted">Same product, calculation version and source contract; values are presented neutrally.</p>
      </div>
      <MetricMatrix countries={countries} />
      <ComparisonTrendCharts countries={countries} />
      <ComponentMatrix countries={countries} />
      <CompetitiveStructure countries={countries} />
      <ProvenanceMatrix countries={countries} />
      <div className="rounded-[12px] p-4 flex items-start gap-2.5 text-[11.5px] leading-relaxed text-text-secondary" style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}>
        <Info size={14} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
        <p><span className="font-medium text-text-primary">Trade proxy — HS17 090421.</span> Trade data represents dried chilli under HS 090421 at market level and is used as a proxy for demand. It does not prove imports specifically originated from Guntur and is not company-level evidence. Recommendation status therefore remains indicative for this mapping.</p>
      </div>
    </section>
  );
}
