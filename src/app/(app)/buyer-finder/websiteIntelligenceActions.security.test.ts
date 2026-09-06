import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HERE = process.cwd();

const ACTION = readFileSync(
  path.resolve(HERE, "src/app/(app)/buyer-finder/websiteIntelligenceActions.ts"),
  "utf8",
);
const ORCHESTRATOR = readFileSync(
  path.resolve(HERE, "src/lib/buyerIntelligence/websiteResearch.ts"),
  "utf8",
);
const EXTRACT = readFileSync(
  path.resolve(HERE, "src/lib/buyerFinder/publicWebsiteBusinessExtract.ts"),
  "utf8",
);
const UI = readFileSync(
  path.resolve(HERE, "src/components/buyerFinder/BuyerIntelligenceWebsiteResearch.tsx"),
  "utf8",
);

describe("BI3 website research — safety envelope", () => {
  it("action starts with 'use server' and requires an MDF session", () => {
    expect(ACTION.split("\n")[0]).toContain('"use server"');
    expect(ACTION).toContain("await requireMdfSession()");
  });

  it("browser cannot choose workspace, evidence level, or a source url", () => {
    // Server action's public parameters carry only the candidate id.
    const signature =
      ACTION.match(/export async function researchCandidateWebsiteAction[\s\S]*?\)/)?.[0] ?? "";
    expect(signature).toMatch(/candidateId:\s*string/);
    expect(signature).not.toMatch(/workspaceId\b/);
    expect(signature).not.toMatch(/evidenceLevel\b/);
    expect(signature).not.toMatch(/sourceUrl\b/);
    // Any exported browser-input type (there is none right now) must
    // not carry those fields either.
    const browserTypes = [...ACTION.matchAll(/export type \w+[\s\S]*?\n\};/g)].map((m) => m[0]);
    for (const t of browserTypes) {
      expect(t).not.toMatch(/workspaceId\??\s*:/);
      expect(t).not.toMatch(/evidenceLevel\??\s*:/);
      expect(t).not.toMatch(/sourceUrl\??\s*:\s*string/);
    }
  });

  it("routes ONLY through BI2 writer RPCs — no direct BI table DML, no observations", () => {
    expect(ACTION).toContain("buyerIntelligenceWriter.ingestSource");
    expect(ACTION).toContain("buyerIntelligenceWriter.ingestClaim");
    // Never call the trade-observation entry point from BI3.
    expect(ACTION).not.toMatch(/ingestObservation/);
    // Never touch BI1 tables directly.
    for (const table of [
      "buyer_intelligence_sources",
      "buyer_intelligence_claims",
      "buyer_trade_observations",
      "buyer_trade_metrics",
      "buyer_intelligence_assessments",
      "buyer_intelligence_assessment_evidence",
    ]) {
      expect(ACTION).not.toMatch(new RegExp(`from\\("${table}"\\)`));
      expect(ACTION).not.toMatch(new RegExp(`\\.rpc\\("${table}`));
    }
  });

  it("does not open any paid/LinkedIn/Google/Hunter data path", () => {
    for (const src of [ACTION, ORCHESTRATOR, EXTRACT, UI]) {
      expect(src).not.toMatch(/linkedin\.com/i);
      expect(src).not.toMatch(/api\.hunter\.io/i);
      expect(src).not.toMatch(/google\.com\/search/i);
      expect(src).not.toMatch(/volza|importyeti|comtrade/i);
      expect(src).not.toMatch(/@\/lib\/gmail/);
      expect(src).not.toMatch(/personalContactReveal/);
      expect(src).not.toMatch(/BUYER_SEND_ENABLED\s*=\s*(?!false)/);
    }
  });

  it("orchestrator reuses the pinned SSRF-safe fetch, never a raw fetch()", () => {
    expect(ORCHESTRATOR).toContain("fetchSafeHtmlPage");
    expect(ORCHESTRATOR).toContain("defaultPinnedFetch");
    // Same-domain enforcement via existing helpers.
    expect(ORCHESTRATOR).toContain("isSameCompanySite");
    expect(ORCHESTRATOR).toContain("parsePublicHttpUrl");
    // No raw global fetch calls.
    expect(ORCHESTRATOR).not.toMatch(/\bawait fetch\(/);
    expect(ORCHESTRATOR).not.toMatch(/\bnew XMLHttpRequest\b/);
  });

  it("action + orchestrator + UI never touch buyers/campaigns/gmail", () => {
    for (const src of [ACTION, ORCHESTRATOR, UI]) {
      expect(src).not.toMatch(/repos\.buyers\.create/);
      expect(src).not.toMatch(/convert_buyer_finder_candidate/);
      expect(src).not.toMatch(/repos\.campaigns/);
      expect(src).not.toMatch(/repos\.recipients/);
      expect(src).not.toMatch(/buyerSendActions/);
      expect(src).not.toMatch(/email-verifier/);
    }
  });

  it("does not persist secret-shaped metadata", () => {
    // The action's safeMetadata never carries auth/tokens/cookies.
    const meta = ACTION.match(/function safeMetadata[\s\S]{0,400}\n\}/)?.[0] ?? "";
    expect(meta).toContain("pageKind");
    expect(meta).not.toMatch(/api.?key|secret|token|cookie|authorization|password|credential/i);
  });

  it("provider id is fixed to 'company_website' and cost class is fixed to 'free'", () => {
    expect(ORCHESTRATOR).toMatch(/BI3_PROVIDER_ID\s*=\s*"company_website"/);
    expect(ACTION).toContain("BI3_PROVIDER_ID");
    expect(ACTION).toMatch(/costClass:\s*"free"/);
    expect(ACTION).toMatch(/accessClass:\s*"public"/);
  });
});
