/**
 * MI0 — country identity for Market Intelligence.
 *
 * Uppercase ISO 3166-1 alpha-2 is the internal code. Display names
 * come from the existing MDF country catalogue
 * (`src/lib/catalogue/countries.ts`) so operators see the same
 * readable labels they see everywhere else. Aliases (`UAE`, `USA`,
 * `UK`, `KSA`, …) resolve to their canonical alpha-2.
 *
 * MI never invents a country. A caller-supplied string that does not
 * resolve to a known alpha-2 returns `undefined`; downstream code must
 * treat unknown countries as "not yet supported" — never as world.
 */

import { COUNTRIES } from "@/lib/catalogue/countries";
import type { CountryAlpha2 } from "./types";

const ALPHA2_TO_NAME: Map<string, string> = new Map(
  COUNTRIES.map((c) => [c.code.toUpperCase(), c.name]),
);

const LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const c of COUNTRIES) {
    const code = c.code.toUpperCase();
    m.set(code, code);
    m.set(c.name.toLowerCase(), code);
    for (const alias of c.aliases ?? []) {
      const key = alias.toLowerCase().trim();
      if (key) m.set(key, code);
    }
  }
  return m;
})();

/** Resolve any operator-facing input to a canonical ISO alpha-2 or undefined. */
export function toCountryAlpha2(input: string | undefined | null): CountryAlpha2 | undefined {
  if (!input) return undefined;
  const raw = input.trim();
  if (!raw) return undefined;
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const upper = raw.toUpperCase();
    if (ALPHA2_TO_NAME.has(upper)) return upper;
    // Fall through — a two-letter alias that is not an assigned
    // ISO alpha-2 (e.g. "UK") may still be a known catalogue alias.
  }
  return LOOKUP.get(raw.toLowerCase());
}

/** Readable label for a canonical alpha-2 code. */
export function countryDisplayName(code: CountryAlpha2 | undefined): string | undefined {
  if (!code) return undefined;
  return ALPHA2_TO_NAME.get(code.toUpperCase());
}

/**
 * Compact list for Market Explorer dropdowns. Same underlying catalogue
 * the Buyers page uses; MI adds no independent country list.
 */
export function marketCountryOptions(): { code: CountryAlpha2; name: string }[] {
  return COUNTRIES.map((c) => ({ code: c.code.toUpperCase(), name: c.name })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
