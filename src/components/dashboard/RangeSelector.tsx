"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { DashboardRange } from "@/lib/dashboard/range";

const OPTIONS: { value: DashboardRange; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

interface Props {
  current: DashboardRange;
}

export function RangeSelector({ current }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function pick(next: DashboardRange) {
    if (next === current) return;
    const sp = new URLSearchParams(params?.toString() ?? "");
    sp.set("range", next);
    startTransition(() => {
      router.replace(`/?${sp.toString()}`, { scroll: false });
    });
  }

  return (
    <div
      role="tablist"
      aria-label="Dashboard time range"
      className="inline-flex items-center rounded-[8px] p-0.5"
      style={{
        backgroundColor: "var(--app-elevated)",
        border: "1px solid var(--app-border)",
      }}
    >
      {OPTIONS.map((o) => {
        const active = o.value === current;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-busy={isPending && active}
            onClick={() => pick(o.value)}
            className="h-7 px-3 text-[11.5px] font-medium tracking-tight rounded-[6px] transition-colors focus-ring-quiet"
            style={{
              backgroundColor: active ? "var(--app-surface)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-muted)",
              boxShadow: active ? "0 1px 0 rgba(255,255,255,0.03) inset" : undefined,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
