import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ACTIONS = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/buyer-finder/conversionActions.ts"),
  "utf8",
);
const DOMAIN = readFileSync(
  path.resolve(process.cwd(), "src/lib/buyerFinder/conversion.ts"),
  "utf8",
);
const REPO = readFileSync(
  path.resolve(process.cwd(), "src/lib/repositories/supabase/buyerFinderConversionRepository.ts"),
  "utf8",
);
const APPROVE = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/buyer-finder/actions.ts"),
  "utf8",
);

describe("BF5A conversion action safety", () => {
  it("starts with use server and requires an MDF session on both exports", () => {
    expect(ACTIONS.split("\n")[0]).toContain('"use server"');
    expect(ACTIONS).toContain("export async function previewCandidateConversionAction");
    expect(ACTIONS).toContain("export async function convertCandidateToBuyerAction");
    const guards = ACTIONS.match(/await requireMdfSession\(\)/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });

  it("browser may send only candidate identity and contact-source identity", () => {
    expect(ACTIONS).toContain("candidateId");
    expect(ACTIONS).toContain("contactId");
    expect(ACTIONS).toContain("publicEmailId");
    expect(ACTIONS).toContain("companyOnly");
    expect(ACTIONS).not.toMatch(/workspaceId\??\s*:/);
    expect(ACTIONS).not.toMatch(/NEXT_PUBLIC/);
    const input = ACTIONS.match(/export type ConversionBrowserInput[\s\S]*?\n\};/)?.[0] ?? "";
    expect(input).not.toMatch(/\b(company|email|country|website|productInterest|firstName|lastName|buyerType)\s*[?:]/);
  });

  it("preview does not insert a Buyer or call the conversion RPC", () => {
    const preview = ACTIONS.match(
      /export async function previewCandidateConversionAction[\s\S]+?^export async function convertCandidateToBuyerAction/m,
    )?.[0] ?? "";
    expect(preview).toContain("buildConversionPreview");
    expect(preview).not.toMatch(/\.convert\(/);
    expect(preview).not.toMatch(/repos\.buyers\.create/);
    expect(preview).not.toMatch(/insertAtomic/);
  });

  it("final convert reloads authoritative rows and calls the conversion repository RPC", () => {
    expect(ACTIONS).toContain("buyerFinderCandidateConversions.convert");
    expect(ACTIONS).toContain("mapProductInterest");
    expect(ACTIONS).not.toMatch(/repos\.buyers\.create/);
    expect(REPO).toContain('rpc("convert_buyer_finder_candidate"');
    expect(REPO).not.toMatch(/from\("buyers"\)[\s\S]{0,80}\.insert/);
  });

  it("does not call Hunter, Gmail, campaigns, verifier, or reveal", () => {
    for (const src of [ACTIONS, DOMAIN, REPO]) {
      expect(src).not.toMatch(/api\.hunter\.io/i);
      expect(src).not.toMatch(/from ["'][^"']*hunter[^"']*["']/i);
      expect(src).not.toMatch(/@\/lib\/gmail/);
      expect(src).not.toMatch(/buyerSendActions/);
      expect(src).not.toMatch(/repos\.campaigns/);
      expect(src).not.toMatch(/repos\.recipients/);
      expect(src).not.toMatch(/email-verifier/);
      expect(src).not.toMatch(/email-finder/);
      expect(src).not.toMatch(/personalContactReveal/);
      expect(src).not.toMatch(/createHunter/);
    }
  });

  it("approveCandidateAction still only updates reviewStatus", () => {
    const approve = APPROVE.match(/export async function approveCandidateAction[\s\S]+?^}/m)?.[0] ?? "";
    expect(approve).toContain('reviewStatus: "approved"');
    expect(approve).not.toMatch(/buyers/);
    expect(approve).not.toMatch(/conversion/i);
    expect(approve).not.toMatch(/convertCandidate/);
  });
});
