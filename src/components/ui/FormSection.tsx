import { cn } from "@/lib/utils";

/**
 * MDF Outreach — canonical FormSection.
 *
 * Groups a set of related fields under a small eyebrow heading and an
 * optional one-line description. Used inside Settings, Buyer form,
 * Campaign forms — every form-level "chapter" should be a FormSection
 * rather than an ad-hoc <div> with a title.
 */
export function FormSection({
  title,
  description,
  children,
  className,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Slot to the right of the title (e.g. an inline info button). */
  actions?: React.ReactNode;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
            {title}
          </h3>
          {description && (
            <p className="mt-1 text-[12px] text-text-secondary leading-relaxed max-w-2xl">
              {description}
            </p>
          )}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}
