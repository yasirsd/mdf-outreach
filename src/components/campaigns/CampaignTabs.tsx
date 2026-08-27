"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "overview", label: "Overview", path: "" },
  { key: "recipients", label: "Recipients", path: "/recipients" },
  { key: "email", label: "Email", path: "/email" },
  { key: "preview", label: "Preview", path: "/preview" },
  { key: "send", label: "Send", path: "/send" },
  { key: "activity", label: "Activity", path: "/activity" },
];

/**
 * MDF Outreach — campaign tab bar.
 *
 * Uses useTransition + router.push so a click is instantly reflected in
 * pending UI (spinner on the destination tab, active bar stays on the
 * current tab until the destination commits). Link's default prefetch
 * is left enabled so hover-warmed routes swap in with no waterfall.
 */
export function CampaignTabs({ campaignId }: { campaignId: string }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const base = `/campaigns/${campaignId}`;

  return (
    <div className="mb-8" style={{ borderBottom: "1px solid var(--app-border)" }}>
      <nav
        className="flex gap-0.5 -mb-px"
        aria-label="Campaign sections"
        aria-busy={pending || undefined}
      >
        {TABS.map((t) => {
          const href = `${base}${t.path}`;
          const isActive =
            (t.path === "" && pathname === base) ||
            (t.path !== "" && pathname.startsWith(href));
          return (
            <Link
              key={t.key}
              href={href}
              prefetch
              aria-current={isActive ? "page" : undefined}
              onClick={(e) => {
                // Same tab click — no-op.
                if (isActive) return;
                e.preventDefault();
                startTransition(() => {
                  router.push(href);
                });
              }}
              className={cn(
                "px-3 py-2.5 text-[12.5px] font-medium transition-colors relative focus-ring-quiet inline-flex items-center gap-1.5",
                isActive
                  ? "text-text-primary"
                  : "text-text-muted hover:text-text-secondary",
                pending && !isActive && "opacity-70",
              )}
            >
              {t.label}
              {pending && !isActive && (
                <Loader2
                  size={11}
                  className="animate-spin text-text-muted"
                  aria-hidden
                />
              )}
              {isActive && (
                <span
                  aria-hidden
                  className="absolute left-3 right-3 -bottom-px h-[2px] rounded-full"
                  style={{ backgroundColor: "var(--brand-orange)" }}
                />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
