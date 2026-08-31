import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ACTIONS = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/buyer-finder/personActions.ts"),
  "utf8",
);
const PROVIDER = readFileSync(
  path.resolve(process.cwd(), "src/lib/buyerFinder/providers/hunter/personDiscovery.ts"),
  "utf8",
);
const ORCH = readFileSync(
  path.resolve(process.cwd(), "src/lib/buyerFinder/personDiscovery.ts"),
  "utf8",
);

describe("BF3A person-discovery safety guardrails", () => {
  it("personActions.ts starts with 'use server' and requires an MDF session", () => {
    expect(ACTIONS.split("\n")[0]).toContain('"use server"');
    expect(ACTIONS).toContain("export async function findCandidateDecisionMakersAction");
    expect(ACTIONS).toContain("await requireMdfSession()");
  });

  it("browser supplies only candidateId — no workspace, key, domain, handle, or score", () => {
    expect(ACTIONS).toMatch(
      /export async function findCandidateDecisionMakersAction\(\s*candidateId: string,/,
    );
    expect(ACTIONS).not.toMatch(/workspaceId\??\s*:/);
    expect(ACTIONS).not.toMatch(/findCandidateDecisionMakersAction\([^)]*apiKey/);
    expect(ACTIONS).not.toMatch(/reveal_handle/);
    expect(ACTIONS).not.toMatch(/NEXT_PUBLIC/);
  });

  it("does not consult the enrichment gate for this free operation", () => {
    expect(ACTIONS).not.toContain("isBuyerFinderHunterEnrichmentEnabled");
    expect(ACTIONS).not.toContain("isBuyerFinderAutoFreeEnrichmentEnabled");
    expect(ACTIONS).not.toContain("isBuyerFinderHunterEnabled");
    expect(ACTIONS).toContain("isBuyerFinderHunterReady");
    expect(ACTIONS).toContain("requireBuyerFinderHunterApiKey");
  });

  it("returns toSafeContacts and never mentions reveal_handle in the safe summary", () => {
    expect(ACTIONS).toContain("toSafeContacts");
    const summary = ACTIONS.match(/export interface SafePersonSearchSummary[\s\S]*?\n\}/)?.[0] ?? "";
    expect(summary).toContain("contacts: SafeBuyerCandidateContact[]");
    expect(summary).not.toMatch(/providerRef|reveal_handle|rawResponse|apiKey/i);
  });

  it("does not implement reveal, Domain Search, Email Finder, or Email Verifier", () => {
    for (const src of [ACTIONS, PROVIDER, ORCH]) {
      expect(src).not.toMatch(/multi-domain-search\/reveal/);
      expect(src).not.toMatch(/\/v2\/domain-search/);
      expect(src).not.toMatch(/\/v2\/email-finder/);
      expect(src).not.toMatch(/\/v2\/email-verifier/);
    }
  });

  it("Hunter person provider is server-only, constructor-injected, and uses the official Multi-Domain URL", () => {
    expect(PROVIDER).toContain('import "server-only"');
    expect(PROVIDER).toContain('export const HUNTER_MULTI_DOMAIN_SEARCH_URL = "https://api.hunter.io/v2/multi-domain-search"');
    expect(PROVIDER).not.toMatch(/NEXT_PUBLIC/);
    expect(PROVIDER).toContain("X-API-KEY");
    expect(PROVIDER).not.toMatch(/searchParams\.set\("search_after"/);
    expect(PROVIDER).not.toMatch(/["']search_after["']\s*:/);
  });

  it("does not import usage or decrement contact-credit buckets", () => {
    expect(ACTIONS).not.toContain("createHunterUsageProvider");
    expect(ORCH).not.toMatch(/from ["']@\/lib\/buyerFinder\/usage["']/);
    expect(ORCH).not.toMatch(/from ["']\.\/usage["']/);
    expect(PROVIDER).not.toMatch(/from ["']\.\/usage["']/);
  });

  it("does not import Gmail, Buyer Send, buyers, campaigns, or recipients", () => {
    expect(ACTIONS).not.toMatch(/@\/lib\/gmail/);
    expect(ACTIONS).not.toMatch(/buyerSendActions/);
    expect(ACTIONS).not.toMatch(/repos\.buyers/);
    expect(ACTIONS).not.toMatch(/repos\.campaigns/);
    expect(ACTIONS).not.toMatch(/repos\.recipients/);
  });
});
