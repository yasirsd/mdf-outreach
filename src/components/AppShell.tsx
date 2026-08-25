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
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { MdfWordmark } from "@/components/brand/MdfWordmark";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/buyers", label: "Buyers", icon: Users },
  { href: "/campaigns", label: "Campaigns", icon: Send },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function AppShell({
  children,
  userEmail,
}: {
  children: React.ReactNode;
  userEmail?: string;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: "var(--app-bg)" }}>
      <aside
        className="hidden md:flex w-[232px] shrink-0 flex-col sticky top-0 h-screen"
        style={{
          backgroundColor: "var(--app-sidebar)",
          borderRight: "1px solid var(--app-border)",
        }}
      >
        <div className="px-4 pt-6 pb-5">
          <Link
            href="/"
            className="flex items-center gap-2 group rounded-[10px] p-1 -m-1 focus-ring"
            aria-label="MDF Outreach — Overview"
          >
            <MdfWordmark tone="light" height={26} />
          </Link>
          <div className="mt-2 pl-1 text-[10px] text-text-muted tracking-[0.16em] uppercase font-medium">
            Outreach · Export Ops
          </div>
        </div>

        <nav className="px-2.5 flex flex-col gap-0.5">
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
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-2.5 pl-3 pr-2.5 py-1.5 rounded-[8px] text-[13px] font-medium transition-colors duration-180 focus-ring-quiet",
                  active
                    ? "text-text-primary bg-white/[0.04]"
                    : "text-text-secondary hover:text-text-primary hover:bg-white/[0.03]",
                )}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r"
                    style={{ backgroundColor: "var(--brand-orange)" }}
                    aria-hidden
                  />
                )}
                <Icon
                  size={15}
                  className={cn(
                    "transition-colors",
                    active ? "text-text-primary" : "text-text-muted group-hover:text-text-secondary",
                  )}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto px-4 pt-5 pb-5" style={{ borderTop: "1px solid var(--app-border)" }}>
          <div className="flex items-center gap-1.5 text-[10.5px] text-text-muted tracking-[0.14em] uppercase">
            <Circle size={7} className="fill-emerald-500 stroke-none" />
            Cloud · Supabase
          </div>
          {userEmail && (
            <>
              <div
                className="mt-3 text-[11.5px] text-text-secondary truncate"
                title={userEmail}
              >
                {userEmail}
              </div>
              <div className="mt-2">
                <SignOutButton className="flex items-center gap-1.5 text-[11.5px] text-text-muted hover:text-text-secondary transition-colors" />
              </div>
            </>
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0" style={{ backgroundColor: "var(--app-bg)" }}>
        <div className="min-h-screen">{children}</div>
      </main>
    </div>
  );
}
