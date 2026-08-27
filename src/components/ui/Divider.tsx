import { cn } from "@/lib/utils";

/**
 * MDF Outreach — subtle divider using the shared border token.
 *
 * Horizontal by default. Use `orientation="vertical"` inside flex
 * rows where a subtle separator between button groups or nav items
 * is needed.
 */
export function Divider({
  className,
  orientation = "horizontal",
  spacing,
}: {
  className?: string;
  orientation?: "horizontal" | "vertical";
  /** Optional vertical margin/padding shortcut. */
  spacing?: "sm" | "md" | "lg";
}) {
  const gap =
    spacing === "lg" ? "my-8" : spacing === "md" ? "my-6" : spacing === "sm" ? "my-4" : "";
  if (orientation === "vertical") {
    return (
      <span
        aria-hidden
        className={cn("inline-block h-4 w-px", className)}
        style={{ backgroundColor: "var(--app-border)" }}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={cn("h-px w-full", gap, className)}
      style={{ backgroundColor: "var(--app-border)" }}
    />
  );
}
