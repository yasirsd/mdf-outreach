"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "overview", label: "Overview", path: "" },
  { key: "recipients", label: "Recipients", path: "/recipients" },
  { key: "email", label: "Email", path: "/email" },
  { key: "preview", label: "Preview", path: "/preview" },
  { key: "send", label: "Send", path: "/send" },
  { key: "activity", label: "Activity", path: "/activity" },
];

export function CampaignTabs({ campaignId }: { campaignId: string }) {
  const pathname = usePathname() ?? "";
  const base = `/campaigns/${campaignId}`;
  return (
    <div className="mb-8" style={{ borderBottom: "1px solid var(--app-border)" }}>
      <nav className="flex gap-0.5 -mb-px" aria-label="Campaign sections">
        {TABS.map((t) => {
          const href = `${base}${t.path}`;
          const isActive =
            (t.path === "" && pathname === base) ||
            (t.path !== "" && pathname.startsWith(href));
          return (
            <Link
              key={t.key}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "px-3 py-2.5 text-[12.5px] font-medium transition-colors relative focus-ring-quiet",
                isActive
                  ? "text-text-primary"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              {t.label}
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
