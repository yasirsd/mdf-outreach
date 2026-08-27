import { cn } from "@/lib/utils";

/**
 * MDF Outreach — canonical Field wrapper.
 *
 * One shell that every form field in the application uses so labels,
 * hints, and error text render consistently. Pair with an <input
 * className="input">, <textarea className="textarea">, or a future
 * <Select>. The visual surface lives in globals.css so this component
 * is layout only.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  id?: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const describedById = id ? `${id}-desc` : undefined;
  const hasError = !!error;
  return (
    <div className={cn("block", className)}>
      {label && (
        <label
          htmlFor={id}
          className="block text-[11.5px] font-medium tracking-[0.02em] mb-1.5 text-text-secondary"
        >
          {label}
          {required && (
            <span aria-hidden style={{ color: "var(--brand-orange)" }}>
              {" "}
              *
            </span>
          )}
        </label>
      )}
      <div aria-describedby={describedById}>{children}</div>
      {(hint || error) && (
        <div
          id={describedById}
          className={cn(
            "mt-1 text-[11.5px] leading-snug",
            hasError ? "text-[color:#F08B7E]" : "text-text-muted",
          )}
        >
          {hasError ? error : hint}
        </div>
      )}
    </div>
  );
}
