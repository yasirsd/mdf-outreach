import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BF2.1 — Buyer Finder domain must NOT import from
 * `@/lib/email/themes/catalogue` or `@/lib/email/themes/types`.
 *
 * The only allowed reference to the email-theme catalogue is via
 * `businessCatalogue.ts`'s optional `emailThemeKey` bridge (used for a
 * future template-conversion boundary; never as the domain authority).
 */

const CORE_FILES = [
  "src/lib/buyerFinder/ingestion.ts",
  "src/lib/buyerFinder/scoring.ts",
  "src/lib/buyerFinder/dedupe.ts",
  "src/lib/buyerFinder/normalize.ts",
  "src/lib/buyerFinder/productKey.ts",
  "src/lib/buyerFinder/source.ts",
  "src/lib/buyerFinder/scorePresentation.ts",
  "src/lib/buyerFinder/providers/types.ts",
  "src/lib/buyerFinder/providers/hunter/query.ts",
  "src/lib/buyerFinder/providers/hunter/companyDiscovery.ts",
  "src/lib/buyerFinder/providers/hunter/usage.ts",
  "src/lib/buyerFinder/providers/hunter/errors.ts",
  "src/lib/buyerFinder/providers/mock/companyDiscovery.ts",
  "src/lib/buyerFinder/providers/mock/contactEnrichment.ts",
  "src/app/(app)/buyer-finder/actions.ts",
  "src/app/(app)/buyer-finder/BuyerFinderView.tsx",
  "src/app/(app)/buyer-finder/SearchView.tsx",
  "src/app/(app)/buyer-finder/QueueView.tsx",
  "src/app/(app)/buyer-finder/candidate/[id]/CandidateView.tsx",
  "src/components/buyerFinder/CandidateCard.tsx",
];

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), "utf8");
}

describe("BF2.1 — Buyer Finder is decoupled from email theme catalogue", () => {
  it.each(CORE_FILES)(
    "%s does not import from @/lib/email/themes/*",
    (file) => {
      const src = read(file);
      expect(src).not.toMatch(/from\s+"@\/lib\/email\/themes\/catalogue"/);
      expect(src).not.toMatch(/from\s+"@\/lib\/email\/themes\/types"/);
    },
  );

  it("only businessCatalogue.ts references the email-theme ProductKey (as a typed optional bridge)", () => {
    const bridge = read("src/lib/buyerFinder/businessCatalogue.ts");
    expect(bridge).toContain("@/lib/email/themes/types");
    expect(bridge).toContain("emailThemeKey");
  });

  it("Hunter query keyword table is keyed by BUSINESS product ids, not email theme keys", () => {
    const src = read("src/lib/buyerFinder/providers/hunter/query.ts");
    // Business ids present:
    for (const id of [
      "guntur-dry-red-chilli",
      "banganapalli-mango",
      "indian-pomegranate",
      "indian-apples",
    ]) {
      expect(src).toContain(`"${id}"`);
    }
    // Legacy email-theme keys NOT used as keyword-map keys.
    // (The literal string may appear inside the "hybrid" comment header
    // — we only assert it is NOT a Record<> key, which would look like
    // `"guntur-chilli":`.)
    expect(src).not.toMatch(/"guntur-chilli":/);
    expect(src).not.toMatch(/"pomegranate":/);
    expect(src).not.toMatch(/"indian-apple":/);
  });
});
