import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F9-follow-up — Buyers legacy Country / Product filter values.
 *
 * The Buyers page filter must accept a persisted value that is not in
 * the canonical MDF catalogue (e.g. `?country=UAE` even though the
 * catalogue's canonical label is "United Arab Emirates", or
 * `?product=Cardamom` where Cardamom is not an active MDF product).
 * The filter chip is rendered as "Value · Legacy". BuyerForm remains
 * canonical-only — legacy passthrough exists ONLY in filtering.
 */

const VIEW = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/buyers/BuyersView.tsx"),
  "utf8",
);
const FORM = readFileSync(
  path.resolve(process.cwd(), "src/components/buyers/BuyerForm.tsx"),
  "utf8",
);

describe("BuyersView legacy filter passthrough", () => {
  it("country options include a Legacy fallback when the URL value is unknown", () => {
    // Country options block appends a `Legacy` description if the
    // current filter value isn't already in the canonical set.
    expect(VIEW).toMatch(
      /countryOptions[\s\S]{0,400}description:\s*"Legacy"/,
    );
  });

  it("product options include a Legacy fallback when the URL value is unknown", () => {
    expect(VIEW).toMatch(
      /productOptions[\s\S]{0,400}description:\s*"Legacy"/,
    );
  });

  it("countryOptions rebuilds when the URL country value changes", () => {
    // useMemo dependency on the applied filter value.
    expect(VIEW).toMatch(
      /countryOptions[\s\S]{0,500}\}\,\s*\[initialFilters\.country\]\)/,
    );
  });

  it("productOptions rebuilds when the URL product value changes", () => {
    expect(VIEW).toMatch(
      /productOptions[\s\S]{0,500}\}\,\s*\[initialFilters\.product\]\)/,
    );
  });
});

describe("BuyerForm remains canonical-only (no legacy CREATION escape hatch)", () => {
  it("country and product comboboxes explicitly disable custom entry", () => {
    // The form may HINT that an existing persisted value is legacy
    // (preserving F5 behaviour), but the country/product comboboxes
    // must NOT let an operator type a new legacy value at save-time.
    // Both comboboxes carry `allowCustom={false}`.
    const matches = FORM.match(/allowCustom=\{false\}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
