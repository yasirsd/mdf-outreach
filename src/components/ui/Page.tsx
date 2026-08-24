import { cn } from "@/lib/utils";

export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("mx-auto max-w-[1180px] px-6 md:px-10 py-10 md:py-12", className)}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-6 mb-10">
      <div>
        {eyebrow && (
          <div className="text-[11px] tracking-[0.16em] uppercase text-brand-orange mb-3">
            {eyebrow}
          </div>
        )}
        <h1 className="font-serif font-medium text-[40px] leading-[1.05] tracking-[-0.02em] text-brand-charcoal">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-3 text-brand-muted text-[15px] leading-relaxed max-w-xl">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
