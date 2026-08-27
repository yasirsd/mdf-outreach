import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F8 guardrail — the F8-owned modules must not import Buyer Finder
 * code, and none of them may accidentally reach into the buyer-finder
 * directory tree. This protects the "Buyer Finder is developed
 * separately" boundary.
 */

// F8-owned modules. The repository interface/impl files pre-date F8 and
// legitimately expose BuyerCandidate types across the boundary — that
// interface contract is out of scope for F8 isolation. The isolation
// rule here is: F8's own new modules must not reach into buyer-finder.
const F8_FILES = [
  "src/lib/env.ts",
  "src/lib/env.test.ts",
  "src/lib/email/ctaUrl.ts",
  "src/lib/email/ctaUrl.test.ts",
  "src/lib/gmail/preflight.ts",
  "src/lib/repositories/supabase/buyerPagination.test.ts",
  "docs/production-readiness.md",
];

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), "utf8");
}

describe("F8 isolation from Buyer Finder", () => {
  for (const f of F8_FILES) {
    it(`${f} does not import buyer-finder / hunter code`, () => {
      const src = read(f);
      expect(src).not.toMatch(/@\/lib\/buyerFinder/);
      expect(src).not.toMatch(/@\/components\/buyerFinder/);
      expect(src).not.toMatch(/@\/app\/\(app\)\/buyer-finder/);
      expect(src).not.toMatch(/\bhunter\b/i);
    });
  }
});
