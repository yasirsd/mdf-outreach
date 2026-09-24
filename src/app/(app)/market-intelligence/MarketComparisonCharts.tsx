"use client";

import { formatPercent, formatUsdCompact } from "@/lib/marketIntelligence/format";
import type { MarketIntelligenceDetail } from "@/lib/marketIntelligence/read/overview";

const WIDTH = 760;
const HEIGHT = 248;
const PADDING = { top: 20, right: 18, bottom: 30, left: 58 };

interface ComparisonSeriesInput {
  key: string;
  label: string;
  points: Array<{ period: string; value: number | null }>;
}

interface PositionedPoint {
  period: string;
  value: number;
  x: number;
  y: number;
}

export interface ComparisonSeriesGeometry {
  minYear: number;
  maxYear: number;
  maxValue: number;
  series: Array<{
    key: string;
    label: string;
    points: PositionedPoint[];
    segments: PositionedPoint[][];
  }>;
}

/** Missing values and missing calendar years break a country's line. */
export function buildComparisonChartGeometry(
  input: readonly ComparisonSeriesInput[],
): ComparisonSeriesGeometry | null {
  const boundedInput = input.slice(0, 4);
  const years = boundedInput.flatMap((series) => series.points)
    .map((point) => Number(point.period))
    .filter((year) => Number.isInteger(year));
  const values = boundedInput.flatMap((series) => series.points)
    .map((point) => point.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (years.length === 0 || values.length === 0) return null;

  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const maxValue = Math.max(...values, 0);
  const yearSpan = Math.max(maxYear - minYear, 1);
  const valueSpan = Math.max(maxValue, 1);
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const series = boundedInput.map((item) => {
    const ordered = [...item.points]
      .filter((point) => Number.isInteger(Number(point.period)))
      .sort((a, b) => Number(a.period) - Number(b.period));
    const points: PositionedPoint[] = [];
    const segments: PositionedPoint[][] = [];
    let active: PositionedPoint[] = [];
    for (const point of ordered) {
      const previous = active[active.length - 1];
      const valid = typeof point.value === "number" && Number.isFinite(point.value);
      const gap = previous && Number(point.period) - Number(previous.period) !== 1;
      if (!valid || gap) {
        if (active.length > 0) segments.push(active);
        active = [];
      }
      if (valid) {
        const positioned: PositionedPoint = {
          period: point.period,
          value: point.value!,
          x: minYear === maxYear
            ? PADDING.left + plotWidth / 2
            : PADDING.left + ((Number(point.period) - minYear) / yearSpan) * plotWidth,
          y: PADDING.top + plotHeight - (point.value! / valueSpan) * plotHeight,
        };
        points.push(positioned);
        active.push(positioned);
      }
    }
    if (active.length > 0) segments.push(active);
    return { key: item.key, label: item.label, points, segments };
  });

  return { minYear, maxYear, maxValue, series };
}

const SERIES_STYLES = [
  { color: "var(--brand-orange)", dash: undefined, marker: "circle" },
  { color: "var(--text-primary)", dash: "8 4", marker: "square" },
  { color: "var(--text-secondary)", dash: "2 4", marker: "diamond" },
  { color: "var(--brand-chilli)", dash: "10 3 2 3", marker: "triangle" },
] as const;

function Marker({
  x, y, kind, color, label,
}: {
  x: number;
  y: number;
  kind: (typeof SERIES_STYLES)[number]["marker"];
  color: string;
  label: string;
}) {
  const common = { fill: "var(--app-surface)", stroke: color, strokeWidth: 2, vectorEffect: "non-scaling-stroke" as const };
  if (kind === "square") return <rect x={x - 3.5} y={y - 3.5} width="7" height="7" {...common}><title>{label}</title></rect>;
  if (kind === "diamond") return <path d={`M ${x} ${y - 5} L ${x + 5} ${y} L ${x} ${y + 5} L ${x - 5} ${y} Z`} {...common}><title>{label}</title></path>;
  if (kind === "triangle") return <path d={`M ${x} ${y - 5} L ${x + 5} ${y + 4} L ${x - 5} ${y + 4} Z`} {...common}><title>{label}</title></path>;
  return <circle cx={x} cy={y} r="4" {...common}><title>{label}</title></circle>;
}

function ComparisonChart({
  title,
  subtitle,
  series,
  formatValue,
}: {
  title: string;
  subtitle: string;
  series: ComparisonSeriesInput[];
  formatValue: (value: number | null) => string;
}) {
  const geometry = buildComparisonChartGeometry(series);
  return (
    <section
      className="rounded-[12px] p-3.5 sm:p-4"
      style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}
      aria-label={title}
    >
      <h3 className="text-[13px] font-semibold text-text-primary">{title}</h3>
      <p className="mt-0.5 text-[10.5px] text-text-muted">{subtitle}</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2" aria-label="Chart legend">
        {series.map((item, index) => {
          const style = SERIES_STYLES[index]!;
          return (
            <div key={item.key} className="inline-flex items-center gap-1.5 text-[10.5px] text-text-secondary">
              <svg width="27" height="10" aria-hidden>
                <line x1="1" x2="26" y1="5" y2="5" stroke={style.color} strokeWidth="2" strokeDasharray={style.dash} />
              </svg>
              {item.label}
            </div>
          );
        })}
      </div>
      {!geometry ? (
        <p className="mt-6 text-[12px] text-text-muted">Not available</p>
      ) : (
        <>
          <svg
            className="mt-2 block h-auto w-full min-w-[520px] overflow-visible"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="group"
            aria-label={`${title}, ${geometry.series.length} countries`}
          >
            <title>{title}</title>
            <desc>{subtitle}. Each line is persisted annual evidence; gaps are not interpolated.</desc>
            {[0, 0.5, 1].map((ratio) => {
              const y = PADDING.top + (HEIGHT - PADDING.top - PADDING.bottom) * ratio;
              return <line key={ratio} x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y} y2={y} stroke="var(--app-border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />;
            })}
            <text x="0" y={PADDING.top + 4} fill="var(--text-secondary)" fontSize="11">{formatValue(geometry.maxValue)}</text>
            <text x="0" y={HEIGHT - PADDING.bottom + 4} fill="var(--text-secondary)" fontSize="11">{formatValue(0)}</text>
            <text x={PADDING.left} y={HEIGHT - 7} fill="var(--text-secondary)" fontSize="11">{geometry.minYear}</text>
            <text x={WIDTH - PADDING.right} y={HEIGHT - 7} fill="var(--text-secondary)" fontSize="11" textAnchor="end">{geometry.maxYear}</text>
            {geometry.series.map((item, index) => {
              const style = SERIES_STYLES[index]!;
              return (
                <g key={item.key} data-comparison-series={item.key}>
                  {item.segments.filter((segment) => segment.length > 1).map((segment, segmentIndex) => (
                    <polyline
                      key={segmentIndex}
                      data-series-segment
                      points={segment.map((point) => `${point.x},${point.y}`).join(" ")}
                      fill="none"
                      stroke={style.color}
                      strokeWidth="2"
                      strokeDasharray={style.dash}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {item.points.map((point) => {
                    const label = `${item.label}, ${point.period}: ${formatValue(point.value)}`;
                    return (
                      <g key={point.period} tabIndex={0} role="img" aria-label={label} className="outline-none">
                        <Marker x={point.x} y={point.y} kind={style.marker} color={style.color} label={label} />
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
          <ul className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2 text-[10.5px] text-text-secondary">
            {geometry.series.map((item) => {
              const latest = item.points[item.points.length - 1];
              return (
                <li key={item.key}>
                  <span className="text-text-primary">{item.label}</span>: {latest
                    ? `${formatValue(latest.value)} in ${latest.period}${item.points.length === 1 ? " · one year available" : ""}`
                    : "not available"}
                </li>
              );
            })}
          </ul>
          <ul className="sr-only">
            {geometry.series.flatMap((item) => item.points.map((point) => (
              <li key={`${item.key}-${point.period}`}>{item.label}, {point.period}: {formatValue(point.value)}</li>
            )))}
          </ul>
        </>
      )}
    </section>
  );
}

export function ComparisonTrendCharts({
  countries,
}: {
  countries: readonly MarketIntelligenceDetail[];
}) {
  const boundedCountries = countries.slice(0, 4);
  const importSeries = boundedCountries.map((country) => ({
    key: country.country.alpha2,
    label: country.country.name,
    points: country.history.map((point) => ({ period: point.period, value: point.totalUsd })),
  }));
  const shareSeries = boundedCountries.map((country) => ({
    key: country.country.alpha2,
    label: country.country.name,
    points: country.history.map((point) => ({ period: point.period, value: point.indiaShare })),
  }));
  return (
    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4 overflow-x-auto focus-ring-quiet" tabIndex={0} aria-label="Scrollable comparison trend charts">
      <ComparisonChart
        title="Import demand over time"
        subtitle="Annual dried chilli import value · missing years remain gaps"
        series={importSeries}
        formatValue={formatUsdCompact}
      />
      <ComparisonChart
        title="India share over time"
        subtitle="India's share of annual import value · missing years remain gaps"
        series={shareSeries}
        formatValue={formatPercent}
      />
    </div>
  );
}
