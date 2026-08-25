import { cn } from "@/lib/utils";

/**
 * The compact "M" mark used in navigation and constrained spaces.
 * Deliberately independent from the full wordmark — this is a stable brand
 * primitive until an official standalone MDF icon asset is supplied.
 */
export function MdfMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[8px] grid place-items-center shrink-0",
        "bg-white/[0.04] border border-white/[0.08]",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <MdfGlyph size={Math.round(size * 0.5)} />
    </div>
  );
}

export function MdfGlyph({ size = 16, tone }: { size?: number; tone?: "light" | "dark" }) {
  const color = tone === "dark" ? "#0C0D0F" : "#F5F5F4";
  return (
    <svg
      width={size}
      height={size * 0.72}
      viewBox="0 0 100 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Simplified M with orange accent — placeholder until full mark asset */}
      <path
        d="M8 66 V6 h11 L36 44 L53 6 h11 V66 h-9 V22 L38 63 h-4 L18 22 V66 z"
        fill={color}
      />
      <rect x="70" y="38" width="22" height="10" rx="1" fill="#F36B21" />
      <path
        d="M96 30 V66 h-8 V60 h-3 c-6 0 -11 -5 -11 -12 s5 -12 11 -12 h3 V30 z M83 42 c-3 0 -5 2 -5 6 s2 6 5 6 h5 V42 z"
        fill={color}
      />
    </svg>
  );
}
