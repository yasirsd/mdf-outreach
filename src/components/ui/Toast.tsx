"use client";

import { create } from "zustand";
import { useEffect } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: string) => void;
}

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = Math.random().toString(36).slice(2, 9);
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (m: string) => useToastStore.getState().push("success", m),
  error: (m: string) => useToastStore.getState().push("error", m),
  info: (m: string) => useToastStore.getState().push("info", m),
};

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {}, []);

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => {
        const Icon =
          t.kind === "success" ? CheckCircle2 : t.kind === "error" ? AlertCircle : Info;
        const color =
          t.kind === "success"
            ? "text-emerald-600"
            : t.kind === "error"
              ? "text-brand-chilli"
              : "text-brand-charcoal";
        return (
          <div
            key={t.id}
            className="reveal pointer-events-auto flex items-start gap-3 bg-white border border-brand-border rounded-xl shadow-panel px-4 py-3 min-w-[280px] max-w-sm"
          >
            <Icon size={18} className={`mt-0.5 shrink-0 ${color}`} />
            <div className="text-sm text-brand-charcoal flex-1 leading-snug">{t.message}</div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-brand-muted hover:text-brand-charcoal p-0.5 -m-0.5"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
