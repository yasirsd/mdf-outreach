import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CASES = [
  ["buyerCandidateRepository.ts", "buyer_candidates"],
  ["buyerCandidateContactRepository.ts", "buyer_candidate_contacts"],
  ["buyerCandidateProductMatchRepository.ts", "buyer_candidate_product_matches"],
  ["buyerCandidatePublicEmailRepository.ts", "buyer_candidate_public_emails"],
  ["buyerFinderSearchRunRepository.ts", "buyer_finder_search_runs"],
  ["buyerFinderFreeEnrichmentJobRepository.ts", "buyer_finder_free_enrichment_jobs"],
  ["buyerFinderContactRevealEventRepository.ts", "buyer_finder_contact_reveal_events"],
  ["buyerFinderConversionRepository.ts", "buyer_finder_candidate_conversions"],
] as const;

function source(file: string): string {
  return readFileSync(join(process.cwd(), "src/lib/repositories/supabase", file), "utf8");
}

function projectSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("workspace-pinned Buyer Finder repositories", () => {
  for (const [file, table] of CASES) {
    it(`${file} explicitly scopes every existing-row operation on ${table}`, () => {
      const blocks = [...source(file).matchAll(new RegExp(`\\.from\\("${table}"\\)([\\s\\S]*?);`, "g"))]
        .map((match) => match[0]);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        if (/\.(insert|upsert)\(/.test(block)) continue;
        expect(block, block).toContain('.eq("workspace_id", this.workspaceId)');
      }
    });
  }

  it("scopes Buyer reads used by conversion preview and returned conversion results", () => {
    const repositories = source("repositories.ts");
    const buyerClass = repositories.slice(
      repositories.indexOf("class SupabaseBuyerRepository"),
      repositories.indexOf("class SupabaseCampaignRepository"),
    );
    const blocks = [...buyerClass.matchAll(/\.from\("buyers"\)([\s\S]*?);/g)].map((match) => match[0]);
    for (const block of blocks) {
      if (/\.(insert|upsert)\(/.test(block)) continue;
      expect(block, block).toContain('.eq("workspace_id", this.workspaceId)');
    }
    expect(source("buyerFinderConversionRepository.ts")).toMatch(
      /from\("buyers"\)[\s\S]*?eq\("workspace_id", this\.workspaceId\)/,
    );
  });

  it("keeps targeted domain and normalized-name reuse on the pinned candidate repository", () => {
    const targeted = projectSource("src/app/(app)/buyer-finder/targetedCandidateActions.ts");
    expect(targeted).toContain("repos.buyerCandidates.findByDomain(normalizedDomain)");
    expect(targeted).toContain("const all = await repos.buyerCandidates.list()");
    expect(targeted).not.toMatch(/\.from\("buyer_candidates"\)/);
  });

  it("keeps broad-discovery dedupe on the pinned candidate snapshot", () => {
    const ingestion = projectSource("src/lib/buyerFinder/ingestion.ts");
    expect(ingestion).toMatch(/loadRecords[\s\S]*?repos\.candidates\.list\(\)/);
    expect(ingestion).toContain("const existingRecords = usableHits.length > 0 ? await loadRecords(repos) : []");
    expect(ingestion).not.toMatch(/\.from\("buyer_candidates"\)/);
  });

  it("keeps review queue and candidate detail on the pinned repository bundle", () => {
    const actions = projectSource("src/app/(app)/buyer-finder/actions.ts");
    expect(actions).toContain("const all = await repos.buyerCandidates.list()");
    expect(actions).toContain("const candidate = await repos.buyerCandidates.get(id)");
    expect(actions).not.toMatch(/\.from\("buyer_candidates"\)/);
  });
});
