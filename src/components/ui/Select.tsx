"use client";

import { SearchableCombobox, type ComboboxOption } from "./SearchableCombobox";

/**
 * MDF Outreach — canonical Select for small taxonomies.
 *
 * A thin visual reuse of SearchableCombobox for taxonomies where a
 * search input would be noise (buyer status, buyer type, campaign
 * status). Same dark surface, same keyboard behaviour — the caller
 * simply passes a fixed list.
 */
export function Select({
  value,
  onChange,
  options,
  emptyLabel,
  disabled,
  id,
  ariaLabel,
  ariaDescribedBy,
  className,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  emptyLabel?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  className?: string;
}) {
  return (
    <SearchableCombobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      emptyLabel={emptyLabel ?? "Select…"}
      disabled={disabled}
      ariaLabel={ariaLabel}
      ariaDescribedBy={ariaDescribedBy}
      className={className}
      allowCustom={false}
    />
  );
}
