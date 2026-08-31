import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ACTIONS = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/buyer-finder/publicContactActions.ts"),
  "utf8",
);
const PROVIDER = readFileSync(
  path.resolve(process.cwd(), "src/lib/buyerFinder/providers/publicWebsite/companyContacts.ts"),
  "utf8",
);
const ORCH = readFileSync(
  path.resolve(process.cwd(), "src/lib/buyerFinder/publicCompanyContacts.ts"),
  "utf8",
);

describe("BF3A.5 public company-contact safety guardrails", () => {
  it("starts with use server, requires an MDF session, and takes only candidateId", () => {
    expect(ACTIONS.split("\n")[0]).toContain('"use server"');
    expect(ACTIONS).toContain("export async function findCandidatePublicCompanyContactsAction");
    expect(ACTIONS).toContain("await requireMdfSession()");
    expect(ACTIONS).toMatch(
      /export async function findCandidatePublicCompanyContactsAction\(\s*candidateId: string,/,
    );
    expect(ACTIONS).not.toMatch(/workspaceId\??\s*:/);
    expect(ACTIONS).not.toMatch(/NEXT_PUBLIC/);
  });

  it("browser cannot supply a website URL, domain, or fetch target", () => {
    const signature = ACTIONS.match(
      /export async function findCandidatePublicCompanyContactsAction\([^)]*\)/,
    )?.[0] ?? "";
    expect(signature).not.toMatch(/website|domain|url|href|sourceUrl/i);
    expect(ACTIONS).toContain("candidate.website");
    expect(ACTIONS).toContain("candidate.domain");
  });

  it("does not consult a public-website enable flag or Hunter gates", () => {
    expect(ACTIONS).not.toContain("isBuyerFinderPublicWebsiteEnabled");
    expect(ACTIONS).not.toContain("isBuyerFinderHunterEnabled");
    expect(ACTIONS).not.toContain("isBuyerFinderHunterReady");
    expect(ACTIONS).not.toContain("isBuyerFinderHunterEnrichmentEnabled");
    expect(ACTIONS).not.toContain("isBuyerFinderAutoFreeEnrichmentEnabled");
    expect(ACTIONS).not.toContain("requireBuyerFinderHunterApiKey");
  });

  it("production fetch is address-pinned, not globalThis.fetch", () => {
    expect(PROVIDER).toContain("defaultPinnedFetch");
    expect(PROVIDER).not.toContain("globalThis.fetch");
  });

  it("does not import Hunter, Prospeo, Apollo, Gmail, buyers, or campaigns", () => {
    for (const src of [ACTIONS, PROVIDER, ORCH]) {
      expect(src).not.toMatch(/api\.hunter\.io/i);
      expect(src).not.toMatch(/from ["'][^"']*hunter[^"']*["']/i);
      expect(src).not.toMatch(/from ["'][^"']*prospeo[^"']*["']/i);
      expect(src).not.toMatch(/from ["'][^"']*apollo[^"']*["']/i);
      expect(src).not.toMatch(/@\/lib\/gmail/);
      expect(src).not.toMatch(/repos\.buyers/);
      expect(src).not.toMatch(/repos\.campaigns/);
      expect(src).not.toMatch(/repos\.recipients/);
    }
  });

  it("does not write people into buyer_candidate_contacts", () => {
    expect(ORCH).not.toMatch(/buyerCandidateContacts/);
    expect(ORCH).not.toMatch(/repositories\.contacts/);
    expect(ACTIONS).not.toMatch(/buyerCandidateContacts\.(create|update)/);
  });
});
