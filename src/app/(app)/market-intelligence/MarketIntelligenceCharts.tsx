"use client";

import { formatPercent, formatUsdCompact, MI2A_EM_DASH } from "@/lib/marketIntelligence/format";
import type {
  AnnualImportPoint,
  OriginRankRow,
} from "@/lib/marketIntelligence/read/overview";

const WIDTH = 420;
const HEIGHT = 174;
const PADDING = { top: 18, right: 12, bottom: 28, left: 48 };

interface SeriesPoint {
  period: string;
  value: number | null;
  secondaryValue?: number | null;
}

interface PositionedPoint extends SeriesPoint {
  x: number;
  y: number;
}

export interface ChartSeriesGeometry {
  points: PositionedPoint[];
  segments: PositionedPoint[][];
  minYear: number;
  maxYear: number;
  maxValue: number;
}

/**
 * Converts persisted annual points into SVG geometry. Missing calendar years
 * and null values split the path, so the chart never draws an observed trend
 * through absent evidence.
 */
export function buildChartSeriesGeometry(points: readonly SeriesPoint[]): ChartSeriesGeometry | null {
  const validYears = points
    .map((point) => Number(point.period))
    .filter((year) => Number.isInteger(year));
  const finiteValues = points
    .map((point) => point.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (validYears.length === 0 || finiteValues.length === 0) return null;

  const minYear = Math.min(...validYears);
  const maxYear = Math.max(...validYears);
  const maxValue = Math.max(...finiteValues, 0);
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const yearSpan = Math.max(maxYear - minYear, 1);
  const valueSpan = Math.max(maxValue, 1);

  const positioned = points
    .filter((point) => Number.isInteger(Number(point.period)))
    .sort((a, b) => Number(a.period) - Number(b.period))
    .map((point): PositionedPoint => ({
      ...point,
      x: PADDING.left + ((Number(point.period) - minYear) / yearSpan) * plotWidth,
      y: typeof point.value === "number" && Number.isFinite(point.value)
        ? PADDING.top + plotHeight - (point.value / valueSpan) * plotHeight
        : PADDING.top + plotHeight,
    }));

  const segments: PositionedPoint[][] = [];
  let active: PositionedPoint[] = [];
  for (const point of positioned) {
    const previous = active[active.length - 1];
    const missingValue = typeof point.value !== "number" || !Number.isFinite(point.value);
    const calendarGap = previous && Number(point.period) - Number(previous.period) !== 1;
    if (missingValue || calendarGap) {
      if (active.length > 0) segments.push(active);
      active = [];
    }
    if (!missingValue) active.push(point);
  }
  if (active.length > 0) segments.push(active);

  return {
    points: positioned.filter((point) => typeof point.value === "number" && Number.isFinite(point.value)),
    segments,
    minYear,
    maxYear,
    maxValue,
  };
}

function latestImportChange(history: readonly AnnualImportPoint[]): string | null {
  const observed = history
    .filter((point): point is AnnualImportPoint & { totalUsd: number } =>
      typeof point.totalUsd === "number" && Number.isFinite(point.totalUsd))
    .sort((a, b) => Number(a.period) - Number(b.period));
  if (observed.length < 2) return null;
  const previous = observed[observed.length - 2]!;
  const latest = observed[observed.length - 1]!;
  if (Number(latest.period) - Number(previous.period) !== 1 || previous.totalUsd <= 0) return null;
  const change = ((latest.totalUsd - previous.totalUsd) / previous.totalUsd) * 100;
  const direction = change > 0 ? "increased" : change < 0 ? "decreased" : "were unchanged";
  return direction === "were unchanged"
    ? `Imports were unchanged in ${latest.period}.`
    : `Imports ${direction} ${Math.abs(change).toFixed(1)}% in ${latest.period}.`;
}

function ChartFrame({
  title,
  subtitle,
  points,
  valueLabel,
  formatValue,
  summary,
  secondaryLabel,
  formatSecondary,
}: {
  title: string;
  subtitle: string;
  points: readonly SeriesPoint[];
  valueLabel: string;
  formatValue: (value: number | null) => string;
  summary?: string | null;
  secondaryLabel?: string;
  formatSecondary?: (value: number | null | undefined) => string;
}) {
  const geometry = buildChartSeriesGeometry(points);
  const observedCount = geometry?.points.length ?? 0;
  const latest = geometry?.points[observedCount - 1];

  return (
    <section
      className="rounded-[10px] p-3.5"
      style={{ backgroundColor: "var(--app-elevated)", border: "1px solid var(--app-border)" }}
      aria-label={title}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-[12.5px] font-semibold text-text-primary">{title}</h4>
          <p className="mt-0.5 text-[10.5px] text-text-muted">{subtitle}</p>
        </div>
        {latest && (
          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted">{latest.period}</div>
            <div className="mt-0.5 text-[12px] font-medium tabular-nums text-text-primary">
              {formatValue(latest.value)}
            </div>
          </div>
        )}
      </div>

      {!geometry || observedCount === 0 ? (
        <p className="mt-5 text-[12px] text-text-muted">Not available</p>
      ) : (
        <>
          <svg
            className="mt-3 block h-auto w-full overflow-visible"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="group"
            aria-label={`${title}: ${observedCount} persisted annual ${observedCount === 1 ? "value" : "values"}`}
          >
            <title>{title}</title>
            <desc>{subtitle}. Values are taken from persisted annual trade evidence.</desc>
            {[0, 0.5, 1].map((ratio) => {
              const y = PADDING.top + (HEIGHT - PADDING.top - PADDING.bottom) * ratio;
              return (
                <line
                  key={ratio}
                  x1={PADDING.left}
                  x2={WIDTH - PADDING.right}
                  y1={y}
                  y2={y}
                  stroke="var(--app-border-strong)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            <text x="0" y={PADDING.top + 4} fill="var(--text-muted)" fontSize="10">
              {formatValue(geometry.maxValue)}
            </text>
            <text x="0" y={HEIGHT - PADDING.bottom + 4} fill="var(--text-muted)" fontSize="10">
              {formatValue(0)}
            </text>
            <text x={PADDING.left} y={HEIGHT - 7} fill="var(--text-muted)" fontSize="10">
              {geometry.minYear}
            </text>
            <text
              x={WIDTH - PADDING.right}
              y={HEIGHT - 7}
              fill="var(--text-muted)"
              fontSize="10"
              textAnchor="end"
            >
              {geometry.maxYear}
            </text>
            {geometry.segments.filter((segment) => segment.length > 1).map((segment, index) => (
              <polyline
                key={index}
                data-series-segment
                points={segment.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke="var(--brand-orange)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {geometry.points.map((point) => {
              const secondary = secondaryLabel && formatSecondary
                ? `; ${secondaryLabel} ${formatSecondary(point.secondaryValue)}`
                : "";
              const accessible = `${point.period}: ${valueLabel} ${formatValue(point.value)}${secondary}`;
              return (
                <circle
                  key={point.period}
                  data-chart-point={point.period}
                  cx={point.x}
                  cy={point.y}
                  r="4"
                  fill="var(--app-elevated)"
                  stroke="var(--brand-orange)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                  tabIndex={0}
                  role="img"
                  aria-label={accessible}
                  className="outline-none focus-visible:[filter:drop-shadow(0_0_4px_var(--brand-orange))]"
                >
                  <title>{accessible}</title>
                </circle>
              );
            })}
          </svg>
          {observedCount === 1 && (
            <p className="mt-1 text-[10.5px] text-text-muted">
              One year of evidence is available; no trend is shown.
            </p>
          )}
          {summary && observedCount > 1 && (
            <p className="mt-1 text-[10.5px] text-text-secondary">{summary}</p>
          )}
          <ul className="sr-only">
            {geometry.points.map((point) => (
              <li key={point.period}>{point.period}: {formatValue(point.value)}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function ImportDemandChart({ history }: { history: readonly AnnualImportPoint[] }) {
  return (
    <ChartFrame
      title="Import demand"
      subtitle="Annual dried chilli imports · HS17 090421"
      points={history.map((point) => ({ period: point.period, value: point.totalUsd }))}
      valueLabel="total import value"
      formatValue={formatUsdCompact}
      summary={latestImportChange(history)}
    />
  );
}

export function IndiaShareChart({ history }: { history: readonly AnnualImportPoint[] }) {
  const latest = [...history]
    .filter((point) => typeof point.indiaShare === "number")
    .sort((a, b) => Number(a.period) - Number(b.period))
    .at(-1);
  const summary = latest
    ? `India supplied ${formatPercent(latest.indiaShare)} of recorded imports in ${latest.period}.`
    : null;
  return (
    <ChartFrame
      title="India share"
      subtitle="Share of this market supplied by India"
      points={history.map((point) => ({
        period: point.period,
        value: point.indiaShare,
        secondaryValue: point.indiaValueUsd,
      }))}
      valueLabel="India share"
      formatValue={formatPercent}
      summary={summary}
      secondaryLabel="India import value"
      formatSecondary={formatUsdCompact}
    />
  );
}

export function OriginCompetitionChart({
  origins,
  latestPeriod,
}: {
  origins: readonly OriginRankRow[];
  latestPeriod: string | null;
}) {
  const top = origins.slice(0, 5);
  return (
    <section aria-labelledby="origin-competition-heading">
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <div>
          <h4 id="origin-competition-heading" className="text-[12.5px] font-semibold text-text-primary">
            Origin competition
          </h4>
          <p className="mt-0.5 text-[10.5px] text-text-muted">
            Top supplying countries · latest complete year
          </p>
        </div>
        <span className="text-[10.5px] tabular-nums text-text-muted">
          {latestPeriod ?? MI2A_EM_DASH}
        </span>
      </div>
      {top.length === 0 ? (
        <p className="text-[12px] text-text-muted">Not available</p>
      ) : (
        <ol className="flex flex-col gap-2.5" aria-label="Latest-period origin shares">
          {top.map((origin) => {
            const isIndia = origin.partnerCountry === "IN";
            const width = typeof origin.share === "number"
              ? `${Math.max(0, Math.min(origin.share * 100, 100))}%`
              : "0%";
            return (
              <li key={origin.partnerCountry}>
                <div className="flex items-baseline justify-between gap-3 text-[11.5px]">
                  <span className={isIndia ? "font-medium text-text-primary" : "text-text-secondary"}>
                    {origin.partnerCountryName ?? origin.partnerCountry}
                    {isIndia && <span className="ml-1 text-[10px] text-brand-orange">India</span>}
                  </span>
                  <span className="tabular-nums text-text-primary">
                    {formatPercent(origin.share)}
                    <span className="ml-2 text-[10.5px] text-text-muted">{formatUsdCompact(origin.valueUsd)}</span>
                  </span>
                </div>
                <div
                  className="mt-1 h-1.5 overflow-hidden rounded-full"
                  style={{ backgroundColor: "var(--app-border)" }}
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-220 motion-reduce:transition-none"
                    style={{
                      width,
                      backgroundColor: isIndia ? "var(--brand-orange)" : "var(--app-border-strong)",
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
