import Link from "next/link";
import type { BuyerPipeline } from "@/lib/dashboard/pipeline";

interface Props {
  pipeline: BuyerPipeline;
}

/**
 * Compact per-stage horizontal bars. Each stage row is:
 *
 *   [ stage label 120px ][ count 32px ][ ─────────── bar ────── ][ % 40px ]
 *
 * MDF orange for meaningful progression stages (contacted / engaged /
 * in-deal / won), muted for prospects / not-interested (which are
 * neutral endpoints of the funnel, not progress).
 */
export function PipelinePanel({ pipeline }: Props) {
  const total = pipeline.total;

  return (
    <section
      aria-labelledby="pipeline-heading"
      className="rounded-[12px] p-5"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2
            id="pipeline-heading"
            className="text-[13px] font-semibold tracking-tight text-text-primary"
          >
            Buyer pipeline
          </h2>
          <p className="mt-0.5 text-[11.5px] text-text-muted">
            {total === 0
              ? "No buyers yet"
              : `${total} buyer${total === 1 ? "" : "s"}`}
          </p>
        </div>
        <Link
          href="/buyers"
          className="text-[11.5px] text-text-muted hover:text-text-primary transition-colors"
        >
          View buyers →
        </Link>
      </div>

      {total === 0 ? (
        <div className="text-[12.5px] text-text-muted leading-relaxed">
          Buyers you add will appear here grouped by pipeline stage.
        </div>
      ) : (
        <ul
          className="space-y-2.5"
          aria-label={buildBarAriaLabel(pipeline)}
        >
          {pipeline.stages.map((s) => {
            const share = total > 0 ? s.count / total : 0;
            const pct = Math.round(share * 100);
            const empty = s.count === 0;
            const isProgress =
              s.tone === "progress" || s.tone === "positive";
            const barColor = empty
              ? "var(--app-border)"
              : isProgress
                ? "var(--brand-orange)"
                : "var(--text-muted)";
            return (
              <li key={s.key} className="grid grid-cols-[110px_28px_1fr_36px] items-center gap-3">
                <span
                  className="text-[12px] text-text-secondary truncate"
                  title={s.label}
                >
                  {s.label}
                </span>
                <span
                  className="text-[12.5px] font-medium tabular-nums text-text-primary text-right"
                >
                  {s.count}
                </span>
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ backgroundColor: "var(--app-elevated)" }}
                  role="presentation"
                  aria-hidden
                >
                  <div
                    style={{
                      width: `${Math.max(empty ? 0 : 2, share * 100)}%`,
                      height: "100%",
                      backgroundColor: barColor,
                      opacity: empty ? 0.4 : 1,
                      transition: "width 220ms ease",
                    }}
                  />
                </div>
                <span
                  className="text-[11px] tabular-nums text-text-muted text-right"
                >
                  {empty ? "" : `${pct}%`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function buildBarAriaLabel(p: BuyerPipeline): string {
  const parts = p.stages
    .filter((s) => s.count > 0)
    .map((s) => `${s.label} ${s.count}`);
  return `Buyer pipeline distribution: ${parts.join(", ")}`;
}
