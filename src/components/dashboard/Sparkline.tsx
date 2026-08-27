/**
 * MDF Outreach — F6 metric-card sparkline.
 *
 * Pure, tiny SVG. Server-renderable (no "use client").
 *
 * Rendering strategy is chosen based on the data itself:
 *
 *   • Fully zero            → flat dashed baseline.
 *   • Sparse (mostly zeros, one or two non-zero spikes) → thin bars
 *     per day; a spike-line would look like a rendering glitch.
 *   • Genuinely time-varying → smooth line.
 *
 * The threshold: if fewer than 30% of days are non-zero AND there are
 * ≤ 3 non-zero days, we use bars; otherwise a line. This keeps small
 * workspaces from showing a lonely vertical spike and preserves the
 * elegance of the line chart for real data.
 */

interface Props {
  values: number[];
  ariaLabel: string;
  width?: number;
  height?: number;
  tone?: "brand" | "muted";
}

export function Sparkline({
  values,
  ariaLabel,
  width = 100,
  height = 22,
  tone = "brand",
}: Props) {
  const max = Math.max(0, ...values);
  const stroke = tone === "muted" ? "var(--text-muted)" : "var(--brand-orange)";

  if (max === 0 || values.length === 0) {
    return (
      <svg
        role="img"
        aria-label={ariaLabel}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>{ariaLabel}</title>
        <line
          x1={2}
          x2={width - 2}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--app-border-strong)"
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const nonZero = values.filter((v) => v > 0).length;
  const sparse = nonZero <= 3 && nonZero / values.length < 0.3;

  if (sparse) return <SparseBars values={values} width={width} height={height} stroke={stroke} ariaLabel={ariaLabel} max={max} />;
  return <LineSparkline values={values} width={width} height={height} stroke={stroke} ariaLabel={ariaLabel} max={max} />;
}

function LineSparkline({
  values,
  width,
  height,
  stroke,
  ariaLabel,
  max,
}: {
  values: number[];
  width: number;
  height: number;
  stroke: string;
  ariaLabel: string;
  max: number;
}) {
  const pad = 2;
  const usableW = Math.max(1, width - 2 * pad);
  const usableH = Math.max(1, height - 2 * pad);
  const stepX = values.length > 1 ? usableW / (values.length - 1) : usableW;
  const points = values.map((v, i) => ({
    x: pad + i * stepX,
    y: pad + usableH * (1 - v / max),
  }));
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <title>{ariaLabel}</title>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}

function SparseBars({
  values,
  width,
  height,
  stroke,
  ariaLabel,
  max,
}: {
  values: number[];
  width: number;
  height: number;
  stroke: string;
  ariaLabel: string;
  max: number;
}) {
  const pad = 2;
  const usableW = Math.max(1, width - 2 * pad);
  const usableH = Math.max(1, height - 2 * pad);
  const step = usableW / values.length;
  // Bars are 1.2px wide max; leave ≥ 1px gap for the eye.
  const barW = Math.max(1, Math.min(1.6, step - 1));
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <title>{ariaLabel}</title>
      {values.map((v, i) => {
        const x = pad + i * step + (step - barW) / 2;
        if (v === 0) {
          // Baseline dot instead of a bar.
          return (
            <circle
              key={i}
              cx={x + barW / 2}
              cy={pad + usableH - 1}
              r={0.6}
              fill="var(--app-border-strong)"
            />
          );
        }
        const h = Math.max(2, usableH * (v / max));
        const y = pad + usableH - h;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx={0.6}
            fill={stroke}
            opacity={0.9}
          />
        );
      })}
    </svg>
  );
}
