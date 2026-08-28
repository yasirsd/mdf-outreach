import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BF2 — the real Hunter production path must NEVER instantiate or import
 * the mock contact enrichment provider.
 *
 * Mock enrichment is deliberately retained for unit / demo tests, but
 * the moment we start persisting real Hunter companies we must NOT
 * attach fabricated people or emails to them.
 */

const ACTIONS = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/buyer-finder/actions.ts"),
  "utf8",
);
const VIEW = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/buyer-finder/BuyerFinderView.tsx"),
  "utf8",
);
const SEARCH_RUN_ACTIONS = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/buyer-finder/searchRunActions.ts"),
  "utf8",
);
const EXECUTE = readFileSync(
  path.resolve(process.cwd(), "src/lib/buyerFinder/executeSearchRun.ts"),
  "utf8",
);

describe("BF2 no mock contact enrichment in real path", () => {
  it("actions.ts does not import the mock contact enrichment provider", () => {
    expect(ACTIONS).not.toMatch(/providers\/mock\/contactEnrichment/);
    expect(ACTIONS).not.toMatch(/createMockContactEnrichmentProvider/);
    expect(ACTIONS).not.toMatch(/MockContactEnrichmentProvider/);
  });

  it("BuyerFinderView (client) does not import ContactEnrichmentProvider anywhere", () => {
    expect(VIEW).not.toMatch(/ContactEnrichmentProvider/);
    expect(VIEW).not.toMatch(/contactEnrichment/);
  });

  it("search-run execute path also omits contact enrichment", () => {
    expect(SEARCH_RUN_ACTIONS).not.toMatch(/providers\/mock\/contactEnrichment/);
    expect(SEARCH_RUN_ACTIONS).not.toMatch(/createMockContactEnrichmentProvider/);
    expect(EXECUTE).not.toMatch(/contactProvider:/);
    expect(EXECUTE).not.toMatch(/createMockContactEnrichmentProvider/);
  });
});

describe("BF2.2C no mock company discovery in production path", () => {
  it("actions.ts does not import the mock company discovery provider", () => {
    expect(ACTIONS).not.toMatch(/providers\/mock\/companyDiscovery/);
    expect(ACTIONS).not.toMatch(/createMockCompanyDiscoveryProvider/);
    expect(ACTIONS).not.toMatch(/MockCompanyDiscoveryProvider/);
  });

  it("search-run production path does not import the mock company provider", () => {
    expect(SEARCH_RUN_ACTIONS).not.toMatch(/providers\/mock\/companyDiscovery/);
    expect(SEARCH_RUN_ACTIONS).not.toMatch(/createMockCompanyDiscoveryProvider/);
    expect(EXECUTE).not.toMatch(/providers\/mock\/companyDiscovery/);
    expect(EXECUTE).not.toMatch(/createMockCompanyDiscoveryProvider/);
  });
});
