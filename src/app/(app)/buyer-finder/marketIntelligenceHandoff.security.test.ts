import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), "utf8");
const PAGE = read("src/app/(app)/buyer-finder/page.tsx");
const VIEW = read("src/app/(app)/buyer-finder/BuyerFinderView.tsx");
const ACTIONS = read("src/app/(app)/buyer-finder/actions.ts");
const HANDOFF = read("src/lib/marketIntelligence/buyerFinderHandoff.ts");
const MI_LINK = read("src/app/(app)/market-intelligence/BuyerFinderHandoffLink.tsx");

describe("MI4 handoff side-effect and evidence isolation", () => {
  it("uses the read-only queue loader only for a validated handoff", () => {
    expect(PAGE).toContain("handoff ? loadBuyerCandidateQueueReadOnlyAction() : loadBuyerCandidateQueueAction()");
    expect(ACTIONS).toMatch(/loadBuyerCandidateQueueReadOnlyAction[\s\S]*repairMissingJobs: false/);
  });

  it("suppresses automatic Hunter usage and stale-run finalization in handoff mode", () => {
    expect(VIEW).toMatch(/if \(isMarketHandoff\) \{\s*setUsage\(null\);\s*return;/);
    expect(VIEW).toMatch(/if \(isMarketHandoff\) return;\s*if \(!activeRun\) return;/);
  });

  it("does not auto-create or auto-execute a search from an effect", () => {
    const runSearchStart = VIEW.indexOf("function runSearch()");
    const createRunCall = VIEW.indexOf("createBuyerFinderSearchRunAction({", runSearchStart);
    const executeRunCall = VIEW.indexOf("startExecute(result.run.id)", runSearchStart);

    expect(runSearchStart).toBeGreaterThan(-1);
    expect(createRunCall).toBeGreaterThan(runSearchStart);
    expect(executeRunCall).toBeGreaterThan(createRunCall);
    expect(VIEW.slice(0, runSearchStart)).not.toContain("createBuyerFinderSearchRunAction({");
    expect(VIEW.slice(0, runSearchStart)).not.toContain("startExecute(result.run.id)");
  });

  it("handoff routing carries no provider, HS, score, email, or arbitrary return authority", () => {
    expect(HANDOFF).not.toMatch(/provider|hsCode|marketFit|confidence|email|returnUrl|redirectUrl/i);
    expect(MI_LINK).not.toMatch(/provider|hsCode|marketFit|confidence|email/i);
    expect(HANDOFF).toContain("buildMarketIntelligenceReturnHref");
  });

  it("handoff code cannot write candidates, Buyers, Buyer Intelligence, or conversions", () => {
    for (const source of [PAGE, VIEW, HANDOFF, MI_LINK]) {
      expect(source).not.toMatch(
        /buyer_trade_observations|buyerTradeObservations|buyer_intelligence|buyerIntelligenceSources|candidate_conversions|candidateConversions|convertCandidate|createBuyer\(|buyerCandidates\.create/i,
      );
    }
  });

  it("page context read imports no provider, reveal, email, or scoring authority", () => {
    expect(PAGE).not.toMatch(/providers\/|revealActions|email|marketFit\.ts|scoreRefresh|cohortMaterialize/i);
  });
});
