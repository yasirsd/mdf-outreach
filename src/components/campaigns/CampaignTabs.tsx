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
    <div className="border-b border-brand-border mb-8">
      <nav className="flex gap-1 -mb-px">
        {TABS.map((t) => {
          const href = `${base}${t.path}`;
          const isActive =
            (t.path === "" && pathname === base) ||
            (t.path !== "" && pathname.startsWith(href));
          return (
            <Link
              key={t.key}
              href={href}
              className={cn(
                "px-3 py-2.5 text-[13.5px] font-medium border-b-2 transition-colors",
                isActive
                  ? "text-brand-charcoal border-brand-charcoal"
                  : "text-brand-muted border-transparent hover:text-brand-charcoal",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
