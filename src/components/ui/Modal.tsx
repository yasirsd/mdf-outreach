"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  actions,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const width =
    size === "sm" ? "max-w-md" : size === "md" ? "max-w-xl" : size === "lg" ? "max-w-3xl" : "max-w-5xl";

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center px-4 transition-opacity duration-200",
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <div className="absolute inset-0 bg-brand-charcoal/30 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cn(
          "relative w-full bg-white border border-brand-border rounded-2xl shadow-panel flex flex-col max-h-[92vh]",
          width,
          open ? "translate-y-0" : "translate-y-2",
        )}
      >
        <div className="px-6 py-5 border-b border-brand-border flex items-start justify-between gap-4">
          <div>
            {title && (
              <div className="font-serif text-[22px] leading-tight tracking-[-0.015em] text-brand-charcoal">
                {title}
              </div>
            )}
            {subtitle && <div className="mt-1 text-[13px] text-brand-muted">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            className="text-brand-muted hover:text-brand-charcoal p-1 -m-1 rounded-md hover:bg-brand-canvas"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {actions && (
          <div className="border-t border-brand-border px-6 py-4 flex items-center justify-end gap-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
