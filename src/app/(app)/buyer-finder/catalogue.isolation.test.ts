import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BF2 — Buyer Finder UI + server action must use the business catalogue
 * (src/lib/catalogue/products.ts) as the authoritative product source.
 *
 * The email theme catalogue is a bridge only — reachable via
 * `businessProductIdToEmailThemeKey` and `findBusinessProductByEmailThemeKey`.
 * Direct source-of-truth imports from `@/lib/email/themes/catalogue` in
 * Buyer Finder UI / server-action files must not creep back in.
 */

const FILES = [
  "src/app/(app)/buyer-finder/actions.ts",
  "src/app/(app)/buyer-finder/searchRunActions.ts",
  "src/app/(app)/buyer-finder/BuyerFinderView.tsx",
  "src/app/(app)/buyer-finder/SearchView.tsx",
  "src/app/(app)/buyer-finder/QueueView.tsx",
  "src/app/(app)/buyer-finder/candidate/[id]/CandidateView.tsx",
  "src/components/buyerFinder/CandidateCard.tsx",
  "src/components/buyerFinder/SearchRunProgress.tsx",
];

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), "utf8");
}

describe("BF2 business catalogue authority", () => {
  it.each(FILES)(
    "%s does not import PRODUCT_CATALOGUE from the email theme catalogue",
    (file) => {
      const src = read(file);
      expect(src).not.toMatch(
        /from\s+"@\/lib\/email\/themes\/catalogue"[^;]*PRODUCT_CATALOGUE/,
      );
      expect(src).not.toMatch(/PRODUCT_CATALOGUE/);
    },
  );

  it("SearchView renders business catalogue products only", () => {
    const src = read("src/app/(app)/buyer-finder/SearchView.tsx");
    expect(src).toContain("activeBusinessProducts");
    expect(src).toContain("@/lib/catalogue/countries");
  });

  it("actions.ts validates business product ids server-side (BF2.1 — no email-theme bridge)", () => {
    const src = read("src/app/(app)/buyer-finder/actions.ts");
    expect(src).toContain("isActiveBusinessProductId");
    // BF2.1 removed the email-theme bridge — Buyer Finder speaks business
    // ids end-to-end.
    expect(src).not.toContain("businessProductIdToEmailThemeKey");
  });

  it("CandidateCard resolves display via the business catalogue by id", () => {
    const src = read("src/components/buyerFinder/CompanyIntelligenceCard.tsx");
    expect(src).toContain("findBusinessProductById");
    expect(src).not.toContain("findBusinessProductByEmailThemeKey");
  });
});
