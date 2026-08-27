"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * MDF Outreach — canonical SearchableCombobox.
 *
 * Built on Radix Popover (a11y + portal + collision detection) plus
 * cmdk (keyboard filter + list semantics). Visual styling is native
 * MDF dark tokens — no shadcn cascade, no bright dropdown.
 *
 * Custom values: when `allowCustom` is true and the operator types a
 * value that does not match any option, an "Add "…"" row appears; on
 * activation the raw string becomes the value. The parent decides
 * whether to persist it.
 *
 * Legacy / unrecognised current value: when the controlled `value`
 * is truthy but no matching option exists in `options`, the trigger
 * renders it with a small "Legacy" chip. Preserving the value on
 * unrelated saves is the parent's responsibility (this component
 * never rewrites values).
 *
 * Async: when `loading` is true the list body shows a spinner. Empty
 * results show `emptyMessage`.
 */

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  /** Additional strings included in the search filter. */
  keywords?: string[];
  /** Optional group label — options with the same group are rendered together. */
  group?: string;
  disabled?: boolean;
}

export interface SearchableComboboxProps {
  id?: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  /** Text shown inside the trigger when no value + no legacy value. */
  emptyLabel?: string;
  /** Row rendered when filter returns nothing AND `allowCustom` is false. */
  emptyMessage?: string;
  disabled?: boolean;
  loading?: boolean;
  /**
   * When true, a value that does not match any option is offered as
   * "Add "…"" — activating adopts the raw typed string as the value.
   */
  allowCustom?: boolean;
  /** Called when the operator explicitly clears the value. */
  onClear?: () => void;
  /** Called with each keystroke of the internal search input. */
  onQueryChange?: (query: string) => void;
  /** Max visible options before the list scrolls. */
  maxRows?: number;
  className?: string;
  /** Popover width — matches trigger by default. */
  popoverWidth?: "trigger" | "auto";
  ariaLabel?: string;
  /** For form field wiring — connects the trigger to a Field hint / error. */
  ariaDescribedBy?: string;
}

export function SearchableCombobox({
  id,
  value,
  onChange,
  options,
  placeholder = "Search…",
  emptyLabel = "Select…",
  emptyMessage = "No matches.",
  disabled = false,
  loading = false,
  allowCustom = false,
  onClear,
  onQueryChange,
  maxRows = 9,
  className,
  popoverWidth = "trigger",
  ariaLabel,
  ariaDescribedBy,
}: SearchableComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Reset query whenever the popover closes so a repeat open starts
  // fresh (matches user expectation of "start typing to find things").
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (onQueryChange) onQueryChange(query);
  }, [query, onQueryChange]);

  const matchedOption = useMemo(
    () => (value ? options.find((o) => o.value === value) : undefined),
    [options, value],
  );
  const isLegacy = !!value && !matchedOption;
  const triggerText = matchedOption?.label ?? (value ?? "");

  // Group options for cmdk rendering. Non-grouped fall into
  // pseudo-group "".
  const grouped = useMemo(() => {
    const map = new Map<string, ComboboxOption[]>();
    for (const o of options) {
      const g = o.group ?? "";
      const arr = map.get(g) ?? [];
      arr.push(o);
      map.set(g, arr);
    }
    return Array.from(map.entries());
  }, [options]);

  return (
    <Popover.Root open={open} onOpenChange={disabled ? undefined : setOpen}>
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          id={id}
          type="button"
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          className={cn(
            "input flex items-center justify-between h-10 gap-2 pr-2 text-left w-full",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className,
          )}
          data-open={open || undefined}
        >
          <span
            className={cn(
              "truncate flex items-center gap-2",
              !value && "text-text-muted",
            )}
          >
            {value ? (
              <>
                <span className="truncate">{triggerText}</span>
                {isLegacy && (
                  <span
                    className="rounded-full text-[10px] font-medium tracking-[0.02em] px-1.5 py-0.5"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.06)",
                      color: "var(--text-muted)",
                      border: "1px solid var(--app-border)",
                    }}
                  >
                    Legacy
                  </span>
                )}
              </>
            ) : (
              emptyLabel
            )}
          </span>
          <span className="inline-flex items-center gap-1 shrink-0">
            {value && onClear && !disabled ? (
              <span
                role="button"
                tabIndex={0}
                aria-label="Clear"
                className="p-1 -mr-1 rounded-md text-text-muted hover:text-text-primary hover:bg-app-hover"
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    e.preventDefault();
                    onClear();
                  }
                }}
              >
                <X size={13} />
              </span>
            ) : null}
            <ChevronDown
              size={14}
              className="text-text-muted transition-transform data-[open=true]:rotate-180"
              data-open={open || undefined}
            />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-[70]"
          style={{
            width: popoverWidth === "trigger" ? "var(--radix-popover-trigger-width)" : undefined,
          }}
        >
          <Command
            filter={cmdkFilter}
            className="rounded-[10px] overflow-hidden shadow-panel"
            style={{
              backgroundColor: "var(--app-elevated)",
              border: "1px solid var(--app-border-strong)",
            }}
          >
            <div
              className="px-3 py-2"
              style={{ borderBottom: "1px solid var(--app-border)" }}
            >
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder={placeholder}
                className="w-full bg-transparent outline-none text-[13.5px] text-text-primary placeholder:text-text-muted"
                autoFocus
              />
            </div>
            <Command.List
              className="overflow-y-auto"
              style={{ maxHeight: maxRows * 34 + 8 }}
            >
              {loading ? (
                <div className="px-3 py-6 flex items-center gap-2 text-[12.5px] text-text-muted">
                  <Loader2 size={12} className="animate-spin" /> Loading…
                </div>
              ) : (
                <>
                  <Command.Empty className="px-3 py-4 text-[12.5px] text-text-muted">
                    {allowCustom && query.trim()
                      ? null // handled by custom row below
                      : emptyMessage}
                  </Command.Empty>
                  {grouped.map(([groupName, groupOptions]) => (
                    <Command.Group
                      key={groupName || "_"}
                      heading={
                        groupName ? (
                          <div className="px-3 pt-2 pb-1 text-[10px] tracking-[0.14em] uppercase text-text-muted font-medium">
                            {groupName}
                          </div>
                        ) : undefined
                      }
                    >
                      {groupOptions.map((o) => (
                        <Command.Item
                          key={o.value}
                          value={`${o.label} ${o.keywords?.join(" ") ?? ""}`}
                          disabled={o.disabled}
                          onSelect={() => {
                            if (o.disabled) return;
                            onChange(o.value);
                            setOpen(false);
                          }}
                          className={cn(
                            "flex items-center justify-between gap-3 px-3 py-2 text-[13px] cursor-pointer",
                            "data-[selected=true]:bg-app-hover",
                            "aria-disabled:opacity-50 aria-disabled:cursor-not-allowed",
                          )}
                        >
                          <span className="flex-1 min-w-0">
                            <span className="block truncate text-text-primary">{o.label}</span>
                            {o.description && (
                              <span className="block truncate text-[11.5px] text-text-muted">
                                {o.description}
                              </span>
                            )}
                          </span>
                          {value === o.value && (
                            <Check
                              size={13}
                              className="text-[color:var(--brand-orange)] shrink-0"
                              aria-label="Selected"
                            />
                          )}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ))}
                  {allowCustom && query.trim() && !options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase()) && (
                    <Command.Item
                      value={`__add:${query}`}
                      onSelect={() => {
                        onChange(query.trim());
                        setOpen(false);
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-[13px] cursor-pointer border-t data-[selected=true]:bg-app-hover"
                      style={{ borderColor: "var(--app-border)" }}
                    >
                      <span className="text-text-muted">Add</span>
                      <span className="text-[color:var(--brand-orange)] truncate">
                        &ldquo;{query.trim()}&rdquo;
                      </span>
                    </Command.Item>
                  )}
                </>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * cmdk's built-in filter uses a fuzzy match that ranks unrelated
 * options above literal prefix matches. We supply our own — simple
 * case-insensitive substring test — which matches operator expectation
 * for a business dropdown.
 */
function cmdkFilter(value: string, search: string): number {
  if (!search) return 1;
  const s = search.toLowerCase();
  const v = value.toLowerCase();
  if (v.startsWith(s)) return 1;
  if (v.includes(s)) return 0.75;
  return 0;
}
