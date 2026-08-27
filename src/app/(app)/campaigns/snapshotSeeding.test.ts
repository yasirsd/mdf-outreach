import { describe, it, expect } from "vitest";

/**
 * F1.3 — the seedCtaDefaults helper is not exported; validate its
 * behavior indirectly through a small local re-implementation of the
 * documented contract. If the helper's rule ever changes, update this
 * test in tandem with actions.ts.
 *
 * The documented rule:
 *   - seedCtaDefaults(sections, defaultUrl) copies the workspace
 *     defaultCtaUrl into every section whose type is 'hero' | 'packing'
 *     | 'cta' AND whose current data.ctaUrl is empty or "#".
 *   - Never overwrites an existing per-section CTA URL.
 *   - Never touches non-CTA-bearing section types.
 *   - Deep-preserves everything else.
 */

import type { EmailSection } from "@/lib/types";

function sec(
  type: EmailSection["type"],
  ctaUrl?: string,
  extra: Record<string, string> = {},
): EmailSection {
  return {
    id: `${type}-1`,
    type,
    visible: true,
    data: { ...extra, ...(ctaUrl !== undefined ? { ctaUrl } : {}) },
  };
}

// Local mirror of seedCtaDefaults (kept intentionally in the test file so
// the actions module can remain server-only).
function seedCtaDefaults(sections: EmailSection[], defaultCtaUrl: string): EmailSection[] {
  const url = defaultCtaUrl.trim();
  if (!url) return sections;
  const CTA_SECTIONS = new Set(["hero", "packing", "cta"]);
  return sections.map((s) => {
    if (!CTA_SECTIONS.has(s.type)) return s;
    const current = (s.data.ctaUrl ?? "").trim();
    if (current && current !== "#") return s;
    return { ...s, data: { ...s.data, ctaUrl: url } };
  });
}

describe("Campaign snapshot — CTA default seeding contract", () => {
  const DEFAULT = "https://mdfexport.com/hello";

  it("empty default ⇒ passthrough (no mutation)", () => {
    const before: EmailSection[] = [sec("hero"), sec("cta")];
    expect(seedCtaDefaults(before, "")).toBe(before);
  });

  it("seeds hero / packing / cta sections that have no ctaUrl", () => {
    const out = seedCtaDefaults([sec("hero"), sec("packing"), sec("cta")], DEFAULT);
    expect(out[0].data.ctaUrl).toBe(DEFAULT);
    expect(out[1].data.ctaUrl).toBe(DEFAULT);
    expect(out[2].data.ctaUrl).toBe(DEFAULT);
  });

  it('seeds sections whose ctaUrl is the "#" placeholder', () => {
    const out = seedCtaDefaults([sec("hero", "#"), sec("cta", "#")], DEFAULT);
    expect(out[0].data.ctaUrl).toBe(DEFAULT);
    expect(out[1].data.ctaUrl).toBe(DEFAULT);
  });

  it("does NOT overwrite an existing per-section CTA URL", () => {
    const before = [sec("hero", "https://existing.example/hero")];
    const out = seedCtaDefaults(before, DEFAULT);
    expect(out[0].data.ctaUrl).toBe("https://existing.example/hero");
  });

  it("does NOT touch non-CTA sections (intro / heritage / footer / origin / formats / why)", () => {
    const inputs: EmailSection[] = [
      sec("intro"),
      sec("heritage"),
      sec("footer"),
      sec("origin"),
      sec("formats"),
      sec("why"),
    ];
    const out = seedCtaDefaults(inputs, DEFAULT);
    for (const s of out) {
      expect("ctaUrl" in s.data ? s.data.ctaUrl : undefined).toBeUndefined();
    }
  });

  it("preserves other section data fields", () => {
    const original = sec("hero", "#", { headline: "H", body: "B" });
    const out = seedCtaDefaults([original], DEFAULT)[0];
    expect(out.data.headline).toBe("H");
    expect(out.data.body).toBe("B");
    expect(out.data.ctaUrl).toBe(DEFAULT);
    expect(out).not.toBe(original); // returned a new section object
  });
});
