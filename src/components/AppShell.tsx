"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Send,
  FileText,
  Activity,
  Settings as SettingsIcon,
  CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Onboarding } from "@/components/Onboarding";
import { useWorkspace } from "./WorkspaceProvider";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/buyers", label: "Buyers", icon: Users },
  { href: "/campaigns", label: "Campaigns", icon: Send },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, settings } = useWorkspace();

  const showOnboarding = ready && settings && !settings.onboardingComplete;

  return (
    <div className="min-h-screen flex bg-brand-ivory">
      <aside className="hidden md:flex w-[240px] shrink-0 flex-col border-r border-brand-border bg-brand-ivory sticky top-0 h-screen">
        <div className="px-6 pt-7 pb-5">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-brand-charcoal grid place-items-center">
              <span className="font-serif font-semibold text-white text-[15px] leading-none pt-0.5">M</span>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[15px] font-semibold tracking-tight text-brand-charcoal">MDF</span>
              <span className="text-[10.5px] text-brand-muted tracking-[0.14em] uppercase mt-0.5">
                Outreach
              </span>
            </div>
          </Link>
        </div>

        <nav className="px-3 mt-2 flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname?.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium transition-colors",
                  active
                    ? "bg-white text-brand-charcoal border border-brand-border"
                    : "text-brand-charcoal/70 hover:bg-white/60 hover:text-brand-charcoal border border-transparent",
                )}
              >
                <Icon
                  size={16}
                  className={cn(
                    "transition-colors",
                    active ? "text-brand-orange" : "text-brand-charcoal/50",
                  )}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto px-4 py-5 border-t border-brand-border">
          <div className="flex items-center gap-2 text-[11px] text-brand-muted tracking-[0.14em] uppercase">
            <CircleDot size={10} className="text-emerald-500" />
            MDF Workspace
          </div>
          <div className="mt-1 text-[12px] text-brand-charcoal/80">Local · Saved in this browser</div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="min-h-screen">{children}</div>
      </main>

      {showOnboarding && <Onboarding />}
    </div>
  );
}
