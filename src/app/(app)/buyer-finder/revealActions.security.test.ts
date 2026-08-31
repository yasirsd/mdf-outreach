import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ACTIONS = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/buyer-finder/revealActions.ts"),
  "utf8",
);
const PROVIDER = readFileSync(
  path.resolve(process.cwd(), "src/lib/buyerFinder/providers/hunter/personalReveal.ts"),
  "utf8",
);
const ORCH = readFileSync(
  path.resolve(process.cwd(), "src/lib/buyerFinder/personalContactReveal.ts"),
  "utf8",
);

describe("BF3B personal-reveal safety guardrails", () => {
  it("starts with use server, requires an MDF session, and takes only contactId", () => {
    expect(ACTIONS.split("\n")[0]).toContain('"use server"');
    expect(ACTIONS).toContain("export async function revealCandidatePersonalContactAction");
    expect(ACTIONS).toContain("await requireMdfSession()");
    expect(ACTIONS).toMatch(
      /export async function revealCandidatePersonalContactAction\(\s*contactId: string,/,
    );
    expect(ACTIONS).not.toMatch(/workspaceId\??\s*:/);
    expect(ACTIONS).not.toMatch(/NEXT_PUBLIC/);
  });

  it("browser cannot supply handle, email, domain, credits, or provider", () => {
    const signature = ACTIONS.match(
      /export async function revealCandidatePersonalContactAction\([^)]*\)/,
    )?.[0] ?? "";
    expect(signature).not.toMatch(/handle|email|domain|credits|provider|apiKey/i);
    expect(ACTIONS).toContain("createHunterPersonalContactRevealProvider");
    expect(ORCH).toContain("contact.providerRef");
  });

  it("uses the dedicated reveal gate and does not require the enrichment gate", () => {
    expect(ACTIONS).toContain("isBuyerFinderHunterRevealEnabled");
    expect(ACTIONS).toContain("isBuyerFinderHunterRevealReady");
    expect(ACTIONS).not.toContain("isBuyerFinderHunterEnrichmentEnabled");
    expect(ACTIONS).not.toContain("isBuyerFinderHunterEnabled");
  });

  it("calls only Multi-Domain reveal with a constructor-injected key", () => {
    expect(PROVIDER).toContain('import "server-only"');
    expect(PROVIDER).toContain(
      'export const HUNTER_MULTI_DOMAIN_REVEAL_URL = "https://api.hunter.io/v2/multi-domain-search/reveal"',
    );
    expect(PROVIDER).toContain("X-API-KEY");
    expect(PROVIDER).toContain("handles.length !== 1");
    expect(ACTIONS).not.toMatch(/multi-domain-search\/reveal/);
  });

  it("does not call Domain Search, Email Finder, Email Verifier, Discover, or masked search", () => {
    for (const src of [ACTIONS, PROVIDER, ORCH]) {
      expect(src).not.toMatch(/\/v2\/domain-search/);
      expect(src).not.toMatch(/\/v2\/email-finder/);
      expect(src).not.toMatch(/\/v2\/email-verifier/);
    }
    expect(PROVIDER).not.toMatch(/\/v2\/discover"/);
  });

  it("does not import Gmail, Buyer Send, buyers, campaigns, or recipients", () => {
    expect(ACTIONS).not.toMatch(/@\/lib\/gmail/);
    expect(ACTIONS).not.toMatch(/buyerSendActions/);
    expect(ACTIONS).not.toMatch(/repos\.buyers/);
    expect(ACTIONS).not.toMatch(/repos\.campaigns/);
    expect(ACTIONS).not.toMatch(/repos\.recipients/);
    expect(ORCH).not.toMatch(/is_primary:\s*true/);
  });
});
