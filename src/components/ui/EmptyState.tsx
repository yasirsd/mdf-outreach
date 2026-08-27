import { cn } from "@/lib/utils";

/**
 * MDF Outreach — canonical EmptyState.
 *
 * Used everywhere there is genuinely nothing to show: no buyers, no
 * campaigns, no activity, no send history. Restrained — a small
 * eyebrow, a headline, one line of guidance, and up to two actions.
 */
export function EmptyState({
  eyebrow,
  title,
  body,
  icon,
  actions,
  className,
  variant = "dashed",
}: {
  eyebrow?: string;
  title: string;
  body?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /** Dashed pattern for "empty" states, solid for informational surfaces. */
  variant?: "dashed" | "solid";
}) {
  return (
    <div
      className={cn(
        "rounded-[16px] p-10 md:p-14 text-center",
        className,
      )}
      style={{
        backgroundColor: "var(--app-surface)",
        border:
          variant === "dashed"
            ? "1px dashed var(--app-border-strong)"
            : "1px solid var(--app-border)",
      }}
    >
      <div className="mx-auto max-w-md">
        {icon && (
          <div
            className="mx-auto w-10 h-10 rounded-full flex items-center justify-center mb-4"
            style={{
              backgroundColor: "var(--app-elevated)",
              color: "var(--text-muted)",
              border: "1px solid var(--app-border)",
            }}
            aria-hidden
          >
            {icon}
          </div>
        )}
        {eyebrow && (
          <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium mb-3">
            {eyebrow}
          </div>
        )}
        <h2 className="text-[20px] font-semibold tracking-tight text-text-primary">
          {title}
        </h2>
        {body && (
          <p className="mt-2 text-[13.5px] text-text-secondary leading-relaxed">
            {body}
          </p>
        )}
        {actions && (
          <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
