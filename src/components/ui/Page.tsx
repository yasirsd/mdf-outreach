import { cn } from "@/lib/utils";

export function PageContainer({
  children,
  className,
  size = "default",
}: {
  children: React.ReactNode;
  className?: string;
  size?: "narrow" | "default" | "wide" | "full";
}) {
  const max =
    size === "narrow"
      ? "max-w-[860px]"
      : size === "wide"
        ? "max-w-[1480px]"
        : size === "full"
          ? "max-w-none"
          : "max-w-[1180px]";
  return (
    <div className={cn("mx-auto px-6 md:px-10 py-8 md:py-10", max, className)}>{children}</div>
  );
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
    <div className="flex items-start justify-between gap-6 mb-5">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange mb-2.5 font-medium">
            {eyebrow}
          </div>
        )}
        <h1 className="text-[22px] font-semibold leading-[1.15] tracking-tight text-text-primary">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 text-text-secondary text-[13.5px] leading-relaxed max-w-2xl">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
