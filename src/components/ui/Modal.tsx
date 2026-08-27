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
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /**
   * When true, backdrop click, Escape key, and the header X are
   * suppressed. Use for irreversible / in-flight operations (Buyer
   * Send progress, mid-flight asset upload, etc.) so the modal does
   * not vanish and hide critical progress. Individual action buttons
   * inside can still control their own busy state.
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

  const width =
    size === "sm" ? "max-w-md" : size === "md" ? "max-w-xl" : size === "lg" ? "max-w-3xl" : "max-w-5xl";

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center px-4 transition-opacity duration-220",
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      )}
      aria-hidden={!open}
      role="dialog"
      aria-modal={open ? "true" : undefined}
    >
      <div
        className="absolute inset-0 backdrop-blur-[3px]"
        style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
        onClick={busy ? undefined : onClose}
        data-mdf-backdrop-busy={busy || undefined}
      />
      <div
        className={cn(
          "relative w-full flex flex-col max-h-[92vh] shadow-panel transition-transform duration-220",
          width,
          open ? "translate-y-0" : "translate-y-3",
        )}
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px solid var(--app-border)",
          borderRadius: "var(--radius-dialog)",
        }}
      >
        <div
          className="px-6 py-5 flex items-start justify-between gap-4"
          style={{ borderBottom: "1px solid var(--app-border)" }}
        >
          <div className="min-w-0">
            {title && (
              <div className="text-[17px] font-semibold leading-tight tracking-tight text-text-primary">
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
