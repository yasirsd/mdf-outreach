import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BF2 — Buyer Finder server-action safety guardrails.
 *
 * These invariants live in the shipped source of `actions.ts`. The
 * action itself needs a live Supabase session to execute, so the tests
 * inspect the code that will run under authentication.
 */

const ACTIONS = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/buyer-finder/actions.ts"),
  "utf8",
);
const CONFIG = readFileSync(
  path.resolve(process.cwd(), "src/lib/buyerFinder/config.ts"),
  "utf8",
);

describe("BF2 server-action safety guardrails", () => {
  it("actions.ts starts with 'use server'", () => {
    expect(ACTIONS.split("\n")[0]).toContain('"use server"');
  });

  it("every export awaits requireMdfSession before touching data or Hunter", () => {
    const exportedActions = [
      "searchAndIngestBuyerCandidatesAction",
      "loadBuyerCandidateQueueAction",
      "loadBuyerCandidateAction",
      "approveCandidateAction",
      "rejectCandidateAction",
      "archiveCandidateAction",
      "getHunterUsageAction",
    ];
    for (const name of exportedActions) {
      expect(ACTIONS).toContain(`export async function ${name}`);
    }
    // Three lifecycle actions (approve / reject / archive) share the
    // `assertCandidate` helper which itself runs the auth guard. So
    // we expect at least (exports − 3 shared) + 1 shared = exports − 2
    // guard calls.
    const guardHits = ACTIONS.match(/await requireMdfSession\(\)/g) ?? [];
    expect(guardHits.length).toBeGreaterThanOrEqual(exportedActions.length - 2);
    // The shared helper contains a guard call.
    expect(ACTIONS).toMatch(
      /async function assertCandidate[\s\S]{0,300}await requireMdfSession\(\)/,
    );
  });

  it("never accepts a workspaceId argument from the browser", () => {
    expect(ACTIONS).not.toMatch(/workspaceId\??\s*:/);
    // Nor an internal-repository client-injected identifier.
    expect(ACTIONS).not.toMatch(/supabase[A-Z]/);
  });

  it("never accepts a Hunter API key from the browser", () => {
    // No exported action input interface carries an apiKey field.
    // (The Hunter provider constructor takes { apiKey } but only from
    // the server-only config helper.)
    const inputInterfaces = ACTIONS.match(
      /export interface \w*Input\s*\{[\s\S]*?\}/g,
    ) ?? [];
    expect(inputInterfaces.length).toBeGreaterThan(0);
    for (const iface of inputInterfaces) {
      expect(iface).not.toMatch(/apiKey/);
    }
  });

  it("Hunter key is read only through the server-only config helper", () => {
    expect(ACTIONS).toContain("requireBuyerFinderHunterApiKey");
    expect(ACTIONS).not.toMatch(/process\.env\.BUYER_FINDER_HUNTER_API_KEY/);
    // The config file itself is 'server-only' and reads process.env
    // through a single audited surface.
    expect(CONFIG).toContain('import "server-only"');
    expect(CONFIG).toContain("BUYER_FINDER_HUNTER_API_KEY");
    expect(CONFIG).toContain("BUYER_FINDER_HUNTER_ENABLED");
    expect(CONFIG).toContain("isBuyerFinderHunterEnabled");
    expect(CONFIG).toContain('=== "true"');
    expect(CONFIG).not.toMatch(/NEXT_PUBLIC/);
  });

  it("no NEXT_PUBLIC_* references anywhere in the Buyer Finder server surface", () => {
    expect(ACTIONS).not.toMatch(/NEXT_PUBLIC/);
    expect(CONFIG).not.toMatch(/NEXT_PUBLIC/);
  });

  it("real Hunter path passes NO contactProvider — no mock enrichment against real companies", () => {
    // Look for the search action's discoverAndIngestCandidates() call
    // and prove it does NOT set contactProvider. We strip line comments
    // first so the doc comment in the arg block doesn't false-positive.
    const m = ACTIONS.match(
      /discoverAndIngestCandidates\(\{[\s\S]{0,1200}?\}\)/,
    );
    expect(m).not.toBeNull();
    const callWithoutComments = m![0]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(callWithoutComments).toContain("companyProvider");
    expect(callWithoutComments).not.toContain("contactProvider");
    expect(callWithoutComments).not.toContain("MockContactEnrichmentProvider");
    expect(callWithoutComments).not.toContain(
      "createMockContactEnrichmentProvider",
    );
    expect(ACTIONS).not.toContain("isBuyerFinderHunterEnrichmentEnabled");
    expect(ACTIONS).not.toMatch(/contactProvider\s*:/);
  });

  it("no Gmail / Buyer Send / campaign / recipient / Buyer creation imports", () => {
    expect(ACTIONS).not.toMatch(/@\/lib\/gmail/);
    expect(ACTIONS).not.toMatch(/buyerSendActions/);
    expect(ACTIONS).not.toMatch(/repos\.buyers\.create/);
    expect(ACTIONS).not.toMatch(/saveBuyerAction/);
    expect(ACTIONS).not.toMatch(/repos\.campaigns\./);
    expect(ACTIONS).not.toMatch(/repos\.recipients\./);
  });

  it("safe summary never carries API keys, raw provider payloads, or Supabase errors", () => {
    // The result interface must have no `rawResponse` / `providerJson`
    // / `apiKey` field.
    const summaryIface = ACTIONS.match(
      /export interface SafeIngestionSummary[\s\S]*?\n\}/,
    )?.[0] ?? "";
    expect(summaryIface).not.toMatch(/rawResponse|providerJson|apiKey/i);
    expect(ACTIONS).toContain("translateHunterError");
  });

  it("input validation runs before any Hunter request is issued", () => {
    // The search action returns 'invalid_input' before instantiating
    // the Hunter provider when the country / product fail validation.
    const searchFn = ACTIONS.match(
      /export async function searchAndIngestBuyerCandidatesAction[\s\S]+?^}/m,
    );
    expect(searchFn).not.toBeNull();
    const body = searchFn![0];
    const validationIndex = body.indexOf("return zeroSummary(\"invalid_input\"");
    const providerIndex = body.indexOf("createHunterCompanyDiscoveryProvider(");
    expect(validationIndex).toBeGreaterThan(-1);
    expect(providerIndex).toBeGreaterThan(validationIndex);
  });

  it("candidate ids are validated against a strict UUID pattern (BF2.1)", () => {
    // BF2 accepted the broad mock-era [A-Za-z0-9_-]{1,80}. BF2.1 tightens
    // to a real UUID so a malformed browser id fails safely before PostgREST.
    expect(ACTIONS).toContain("const CANDIDATE_ID_RE = UUID_RE");
    expect(ACTIONS).toMatch(/const UUID_RE\s*=\s*\/\^\[0-9a-f\]\{8\}-/);
  });
});
