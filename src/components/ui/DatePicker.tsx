"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "react-day-picker";
import { CalendarDays, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatFollowUpDate as formatFollowUpDateSafe,
  parseFollowUpDate,
  serializeFollowUpDate,
} from "@/lib/dates/followUp";
import "react-day-picker/dist/style.css";

/**
 * MDF Outreach — canonical DatePicker.
 *
 * Built on react-day-picker for calendar semantics + Radix Popover
 * for portal / a11y. Wraps the canonical date-only follow-up helpers
 * in `src/lib/dates/followUp.ts` — every parse / serialise call goes
 * through that module so timezone edge cases (UTC-12 / UTC+12) cannot
 * shift the calendar day.
 */

export function DatePicker({
  value,
  onChange,
  disabled,
  placeholder = "Pick a date",
  id,
  ariaDescribedBy,
  className,
}: {
  value: string | null | undefined;
  onChange: (isoOrNull: string | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  ariaDescribedBy?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedDate = parseFollowUpDate(value)?.date ?? undefined;

  function onSelect(day: Date | undefined) {
    if (!day) {
      onChange(undefined);
      setOpen(false);
      return;
    }
    onChange(serializeFollowUpDate(day));
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={disabled ? undefined : setOpen}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-describedby={ariaDescribedBy}
          className={cn(
            "input flex items-center justify-between h-10 gap-2 pr-2 text-left w-full",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className,
          )}
        >
          <span
            className={cn(
              "truncate flex items-center gap-2",
              !selectedDate && "text-text-muted",
            )}
          >
            <CalendarDays size={13} className="text-text-muted shrink-0" />
            {value
              ? (formatFollowUpDateSafe(value) || placeholder)
              : placeholder}
          </span>
          {selectedDate && !disabled ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date"
              className="p-1 -mr-1 rounded-md text-text-muted hover:text-text-primary hover:bg-app-hover"
              onClick={(e) => {
                e.stopPropagation();
                onChange(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  onChange(undefined);
                }
              }}
            >
              <X size={13} />
            </span>
          ) : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-[70] rounded-[12px] shadow-panel p-3 mdf-daypicker"
          style={{
            backgroundColor: "var(--app-elevated)",
            border: "1px solid var(--app-border-strong)",
          }}
        >
          <DayPicker
            mode="single"
            selected={selectedDate}
            onSelect={onSelect}
            weekStartsOn={1}
            showOutsideDays
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="text-[12px] px-2 py-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-app-hover"
              onClick={() => onSelect(new Date())}
            >
              Today
            </button>
            <button
              type="button"
              className="text-[12px] px-2 py-1 rounded-md text-text-muted hover:text-text-primary hover:bg-app-hover"
              onClick={() => onSelect(undefined)}
            >
              Clear
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * @deprecated Kept only for tests / external callers written before
 * F5 follow-up. New code should import parseFollowUpDate from
 * "@/lib/dates/followUp".
 */
export function parseIsoToLocalDate(iso: string): Date | undefined {
  return parseFollowUpDate(iso)?.date;
}

/**
 * @deprecated See parseIsoToLocalDate — kept for backward compat.
 */
export function serialiseLocalDayToIso(day: Date): string {
  return serializeFollowUpDate(day) ?? "";
}

function formatLocalDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
