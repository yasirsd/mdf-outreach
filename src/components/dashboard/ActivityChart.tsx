"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DayBucket } from "@/lib/dashboard/timeSeries";

/**
 * MDF Outreach — F6 outreach-activity chart.
 *
 * Dependency-free SVG area/line chart. Design goals:
 *   • Zero JS bundle bloat (no chart library).
 *   • Native dark tokens; matches --brand-orange for the primary series.
 *   • Responsive: fills its container, redraws on resize.
 *   • Accessible: aria-label + <title>/<desc> summary text; a data table
 *     is also rendered visually-hidden so screen readers can inspect
 *     every bucket without pointer hover.
 *   • Pointer + keyboard hover: cursor line + inline value bubble.
 *
 * Renders "successful buyer emails per day" as the primary series. A
 * gentle area fill under the line adds visual weight without demanding
 * axes. Buyers-added is intentionally NOT overlaid here — the primary
 * series is what earns the space; the "Buyers" metric card holds a
 * separate sparkline.
 */

interface Props {
  buckets: DayBucket[];
  label?: string;
  ariaSummary?: string;
}

const HEIGHT = 170;
const PAD_LEFT = 12;
const PAD_RIGHT = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 24;

export function ActivityChart({ buckets, label = "Emails sent", ariaSummary }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(320, Math.round(e.contentRect.width));
        setWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { pathArea, pathLine, points, yMax, xForIndex, yForValue } = useMemo(
    () => buildGeometry(buckets, width),
    [buckets, width],
  );

  const total = buckets.reduce((n, b) => n + b.emails, 0);
  const hover = hoverIndex !== null ? buckets[hoverIndex] : null;
  const summary =
    ariaSummary ??
    `${label} — ${total} in the selected period across ${buckets.length} day${
      buckets.length === 1 ? "" : "s"
    }. Peak was ${yMax} in a single day.`;

  return (
    <div ref={wrapRef} className="relative w-full" style={{ minHeight: HEIGHT }}>
      <svg
        role="img"
        aria-label={summary}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="none"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(ev) => {
          const rect = ev.currentTarget.getBoundingClientRect();
          const relX = ev.clientX - rect.left;
          const idx = closestIndex(relX, points.map((p) => p.x));
          setHoverIndex(idx);
        }}
      >
        <title>{label}</title>
        <desc>{summary}</desc>

        {/* subtle baseline grid */}
        {[0.25, 0.5, 0.75].map((f) => {
          const y = PAD_TOP + (HEIGHT - PAD_TOP - PAD_BOTTOM) * (1 - f);
          return (
            <line
              key={f}
              x1={PAD_LEFT}
              x2={width - PAD_RIGHT}
              y1={y}
              y2={y}
              stroke="var(--app-border)"
              strokeDasharray="2 4"
            />
          );
        })}

        {/* area fill */}
        <path d={pathArea} fill="url(#activity-gradient)" opacity={0.85} />
        {/* main line */}
        <path d={pathLine} fill="none" stroke="var(--brand-orange)" strokeWidth={1.6} />

        {/* dots at every day (small) */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={hoverIndex === i ? 3.5 : 1.5}
            fill="var(--brand-orange)"
            opacity={hoverIndex === i ? 1 : 0.7}
          />
        ))}

        {/* hover cursor */}
        {hover && hoverIndex !== null && (
          <>
            <line
              x1={points[hoverIndex].x}
              x2={points[hoverIndex].x}
              y1={PAD_TOP}
              y2={HEIGHT - PAD_BOTTOM}
              stroke="var(--app-border-strong)"
              strokeDasharray="3 3"
            />
          </>
        )}

        {/* x-axis: first + middle + last labels */}
        {axisTicks(buckets, points).map((t) => (
          <text
            key={t.key}
            x={t.x}
            y={HEIGHT - 8}
            textAnchor={t.anchor}
            fill="var(--text-muted)"
            fontSize={10.5}
            fontWeight={500}
          >
            {t.label}
          </text>
        ))}

        <defs>
          <linearGradient id="activity-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-orange)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--brand-orange)" stopOpacity={0} />
          </linearGradient>
        </defs>
      </svg>

      {hover && hoverIndex !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-[8px] px-2.5 py-1.5 text-[11.5px] shadow-lg"
          style={{
            left: xForIndex(hoverIndex),
            top: Math.max(0, yForValue(hover.emails) - 44),
            backgroundColor: "var(--app-elevated)",
            border: "1px solid var(--app-border-strong)",
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
          }}
        >
          <div className="tabular-nums font-medium">
            {hover.emails} email{hover.emails === 1 ? "" : "s"}
          </div>
          <div className="text-text-muted text-[10.5px]">
            {formatFullDate(hover.dateKey)}
          </div>
        </div>
      )}

      {/* Visually-hidden data table for AT */}
      <table className="sr-only" aria-label={`${label} by day`}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Emails</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.dateKey}>
              <td>{formatFullDate(b.dateKey)}</td>
              <td>{b.emails}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildGeometry(buckets: DayBucket[], width: number) {
  const rawMax = buckets.reduce((n, b) => Math.max(n, b.emails), 0);
  const yMax = Math.max(1, rawMax); // never divide by 0
  const chartW = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
  const chartH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const stepX =
    buckets.length > 1 ? chartW / (buckets.length - 1) : chartW;

  const points = buckets.map((b, i) => {
    const x = PAD_LEFT + i * stepX;
    const y = PAD_TOP + chartH * (1 - b.emails / yMax);
    return { x, y };
  });

  const linePath =
    points.length > 0
      ? points
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
          .join(" ")
      : "";

  const areaPath =
    points.length > 0
      ? `${linePath} L ${(PAD_LEFT + (points.length - 1) * stepX).toFixed(2)} ${
          PAD_TOP + chartH
        } L ${PAD_LEFT} ${PAD_TOP + chartH} Z`
      : "";

  return {
    pathArea: areaPath,
    pathLine: linePath,
    points,
    yMax: rawMax,
    xForIndex: (i: number) => points[i]?.x ?? 0,
    yForValue: (v: number) => PAD_TOP + chartH * (1 - v / yMax),
  };
}

function axisTicks(
  buckets: DayBucket[],
  points: { x: number }[],
): { key: string; x: number; label: string; anchor: "start" | "middle" | "end" }[] {
  if (buckets.length === 0) return [];
  const first = 0;
  const last = buckets.length - 1;
  const mid = Math.floor(buckets.length / 2);
  const rows: { key: string; x: number; label: string; anchor: "start" | "middle" | "end" }[] = [];
  rows.push({
    key: buckets[first].dateKey + "-a",
    x: points[first].x,
    label: shortLabel(buckets[first].dateKey),
    anchor: "start",
  });
  if (buckets.length > 4) {
    rows.push({
      key: buckets[mid].dateKey + "-b",
      x: points[mid].x,
      label: shortLabel(buckets[mid].dateKey),
      anchor: "middle",
    });
  }
  rows.push({
    key: buckets[last].dateKey + "-c",
    x: points[last].x,
    label: shortLabel(buckets[last].dateKey),
    anchor: "end",
  });
  return rows;
}

function shortLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatFullDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function closestIndex(x: number, xs: number[]): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < xs.length; i += 1) {
    const d = Math.abs(xs[i] - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
