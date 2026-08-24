"use client";

import { LogOut } from "lucide-react";

export function SignOutButton({ className }: { className?: string }) {
  function onClick() {
    window.location.assign("/api/auth/sign-out");
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={className ?? "flex items-center gap-2 text-[12.5px] text-brand-charcoal/70 hover:text-brand-charcoal transition-colors"}
    >
      <LogOut size={13} /> Sign out
    </button>
  );
}
