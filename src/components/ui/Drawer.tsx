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
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  width?: string;
  /**
   * When true, backdrop click and Escape are suppressed. Use for
   * in-flight destructive operations that must not be dismissed.
   */
  busy?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 transition-opacity duration-220",
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <div
        className="absolute inset-0 backdrop-blur-[2px]"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onClick={busy ? undefined : onClose}
        data-mdf-backdrop-busy={busy || undefined}
      />
      <div
        className={cn(
          "absolute right-0 top-0 h-full transition-transform duration-220 flex flex-col shadow-panel",
          open ? "translate-x-0" : "translate-x-full",
        )}
        style={{
          width,
          maxWidth: "94vw",
          backgroundColor: "var(--app-surface)",
          borderLeft: "1px solid var(--app-border)",
        }}
      >
        <div
          className="px-6 py-5 flex items-start justify-between gap-4"
          style={{ borderBottom: "1px solid var(--app-border)" }}
        >
          <div className="min-w-0">
            {title && (
              <div className="text-[17px] font-semibold leading-tight tracking-tight text-text-primary truncate">
                {title}
              </div>
            )}
            {subtitle && <div className="mt-1 text-[12.5px] text-text-muted">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-disabled={busy || undefined}
            className="text-text-muted hover:text-text-primary p-1 -m-1 rounded-md hover:bg-app-hover focus-ring-quiet disabled:opacity-40 disabled:pointer-events-none"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {actions && (
          <div
            className="px-6 py-4 flex items-center justify-end gap-2"
            style={{
              borderTop: "1px solid var(--app-border)",
              backgroundColor: "var(--app-sidebar)",
            }}
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
