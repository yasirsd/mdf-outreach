import { cn } from "@/lib/utils";

/*
 * MDF Outreach — dark-mode skeleton primitives.
 *
 * Design rules:
 *   • Surface tone (var(--app-elevated)) with a subtle brighter sweep.
 *     No bright shimmer, no white flashes.
 *   • prefers-reduced-motion → static tint (animation collapses to none
 *     via globals.css's reduce-motion media query).
 *   • All primitives approximate the SHAPE of the final content so the
 *     resolved page does not visibly jump.
 *   • Every primitive gets role="presentation" + aria-hidden so screen
 *     readers ignore the placeholder shell while the parent page-region
 *     carries an aria-busy/aria-live signal.
 */

const BASE =
  "relative overflow-hidden rounded-[6px]";
const TINT: React.CSSProperties = {
  backgroundColor: "var(--app-elevated)",
};

export function Skeleton({
  className,
  style,
  height,
  width,
}: {
  className?: string;
  style?: React.CSSProperties;
  height?: number | string;
  width?: number | string;
}) {
  return (
    <div
      role="presentation"
      aria-hidden
      className={cn(BASE, "mdf-skeleton", className)}
      style={{
        ...TINT,
        height,
        width,
        ...style,
      }}
    />
  );
}

export function SkeletonText({
  lines = 1,
  className,
  lastWidth = "70%",
  size = 14,
}: {
  lines?: number;
  className?: string;
  lastWidth?: string;
  size?: number;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={size}
          width={i === lines - 1 && lines > 1 ? lastWidth : "100%"}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({
  className,
  padding = 20,
  children,
}: {
  className?: string;
  padding?: number;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn("rounded-[12px]", className)}
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
        padding,
      }}
      aria-hidden
    >
      {children ?? (
        <>
          <Skeleton height={11} width="30%" />
          <div className="mt-3">
            <SkeletonText lines={3} />
          </div>
        </>
      )}
    </div>
  );
}

export function SkeletonMetric() {
  return (
    <div
      className="rounded-[12px] p-5"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
      aria-hidden
    >
      <Skeleton height={10} width="45%" />
      <div className="mt-3">
        <Skeleton height={28} width="55%" />
      </div>
    </div>
  );
}

export function SkeletonRow({
  columns = 4,
  className,
}: {
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("grid items-center gap-4 px-5 py-3", className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      aria-hidden
    >
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === 0 ? "80%" : "60%"} />
      ))}
    </div>
  );
}

export function SkeletonTable({
  rows = 8,
  columns = 4,
  showHeader = true,
  className,
}: {
  rows?: number;
  columns?: number;
  showHeader?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("rounded-[12px] overflow-hidden", className)}
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
      role="presentation"
      aria-hidden
    >
      {showHeader && (
        <div
          className="grid items-center gap-4 px-5 py-2.5"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            borderBottom: "1px solid var(--app-border)",
          }}
        >
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} height={10} width="40%" />
          ))}
        </div>
      )}
      <ul className="divide-y" style={{ borderColor: "var(--app-border)" }}>
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i}>
            <SkeletonRow columns={columns} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SkeletonAvatar({ size = 32 }: { size?: number }) {
  return (
    <div
      className="rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: "var(--app-elevated)",
      }}
      aria-hidden
    />
  );
}
