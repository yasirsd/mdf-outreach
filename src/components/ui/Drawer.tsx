"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Drawer({
  open,
  onClose,
  children,
  title,
  subtitle,
  actions,
  width = "480px",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 transition-opacity duration-200",
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <div className="absolute inset-0 bg-brand-charcoal/25 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cn(
          "absolute right-0 top-0 h-full bg-white border-l border-brand-border shadow-panel transition-transform duration-250 flex flex-col",
          open ? "translate-x-0" : "translate-x-full",
        )}
        style={{ width, maxWidth: "94vw" }}
      >
        <div className="px-6 py-5 border-b border-brand-border flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title && (
              <div className="font-serif text-[22px] leading-tight tracking-[-0.015em] text-brand-charcoal truncate">
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
          <div className="border-t border-brand-border px-6 py-4 flex items-center justify-end gap-2 bg-white">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
