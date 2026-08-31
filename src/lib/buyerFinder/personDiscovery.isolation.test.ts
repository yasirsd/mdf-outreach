import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BF3A — production person-discovery path must not reference paid Hunter
 * endpoints. Tests and comments in test files may mention them.
 */

const ROOT = path.resolve(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__fixtures__") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

const PRODUCTION = walk(ROOT);

describe("BF3A no paid Hunter endpoints outside the dedicated reveal provider", () => {
  it("no production file except personalReveal.ts calls Multi-Domain reveal, Domain Search, Email Finder, or Email Verifier", () => {
    const allowedReveal = new Set(["src/lib/buyerFinder/providers/hunter/personalReveal.ts"]);
    const offenders: string[] = [];
    for (const file of PRODUCTION) {
      const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
      const src = readFileSync(file, "utf8");
      if (/api\.hunter\.io\/v2\/domain-search/.test(src)) offenders.push(rel);
      if (/api\.hunter\.io\/v2\/email-finder/.test(src)) offenders.push(rel);
      if (/api\.hunter\.io\/v2\/email-verifier/.test(src)) offenders.push(rel);
      if (/multi-domain-search\/reveal/.test(src) && !allowedReveal.has(rel)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("dedicated reveal provider uses only Multi-Domain reveal", () => {
    const src = readFileSync(
      path.resolve(process.cwd(), "src/lib/buyerFinder/providers/hunter/personalReveal.ts"),
      "utf8",
    );
    expect(src).toContain(
      'export const HUNTER_MULTI_DOMAIN_REVEAL_URL = "https://api.hunter.io/v2/multi-domain-search/reveal"',
    );
    expect(src).not.toMatch(/\/v2\/domain-search/);
    expect(src).not.toMatch(/\/v2\/email-finder/);
    expect(src).not.toMatch(/\/v2\/email-verifier/);
    expect(src).not.toMatch(/\/v2\/discover"/);
    expect(src).not.toMatch(/\/v2\/email-verifier/);
  });

  it("Hunter person discovery is marked free on the descriptor", () => {
    const src = readFileSync(
      path.resolve(process.cwd(), "src/lib/buyerFinder/providers/descriptors.ts"),
      "utf8",
    );
    expect(src).toMatch(/person_discovery:\s*"free"/);
    expect(src).toMatch(/personal_contact_reveal:\s*"paid"/);
    expect(src).toMatch(/email_enrichment:\s*"unavailable"/);
  });
});
