import { describe, it, expect } from "vitest";
import { PRODUCT_THEMES } from "./registry";
import { contrastRatio } from "./contrast";
import type { ProductKey } from "./types";

const WCAG_AA_BODY = 4.5;
const WCAG_AA_LARGE = 3.0;

interface Check {
  label: string;
  fg: (p: (typeof PRODUCT_THEMES)[ProductKey]["palette"]) => string;
  bg: (p: (typeof PRODUCT_THEMES)[ProductKey]["palette"]) => string;
  minRatio: number;
}

// Body-copy pairs — must hit AA (4.5:1).
const BODY_CHECKS: Check[] = [
  { label: "paperText on paper", fg: (p) => p.paperText, bg: (p) => p.paper, minRatio: WCAG_AA_BODY },
  { label: "paperMuted on paper", fg: (p) => p.paperMuted, bg: (p) => p.paper, minRatio: WCAG_AA_BODY },

  { label: "surfaceText on surface", fg: (p) => p.surfaceText, bg: (p) => p.surface, minRatio: WCAG_AA_BODY },
  { label: "surfaceMuted on surface", fg: (p) => p.surfaceMuted, bg: (p) => p.surface, minRatio: WCAG_AA_BODY },

  { label: "darkSurfaceText on darkSurface", fg: (p) => p.darkSurfaceText, bg: (p) => p.darkSurface, minRatio: WCAG_AA_BODY },
  { label: "darkSurfaceMuted on darkSurface", fg: (p) => p.darkSurfaceMuted, bg: (p) => p.darkSurface, minRatio: WCAG_AA_BODY },

  { label: "accentText on accent (MDF orange chip)", fg: (p) => p.accentText, bg: (p) => p.accent, minRatio: WCAG_AA_BODY },
  { label: "ctaText on ctaBg (product CTA button)", fg: (p) => p.ctaText, bg: (p) => p.ctaBg, minRatio: WCAG_AA_BODY },
];

// Eyebrow / dividers are large decorative — AA large (3:1) is acceptable
// because they're always accompanied by high-contrast body copy.
const LARGE_CHECKS: Check[] = [
  { label: "primary eyebrow on paper", fg: (p) => p.primary, bg: (p) => p.paper, minRatio: WCAG_AA_LARGE },
  { label: "primary eyebrow on surface", fg: (p) => p.primary, bg: (p) => p.surface, minRatio: WCAG_AA_LARGE },
];

describe("ProductTheme WCAG contrast — foreground/background pairs", () => {
  for (const [key, theme] of Object.entries(PRODUCT_THEMES) as Array<[
    ProductKey,
    (typeof PRODUCT_THEMES)[ProductKey],
  ]>) {
    describe(key, () => {
      for (const check of BODY_CHECKS) {
        it(`${check.label} ≥ ${check.minRatio}:1`, () => {
          const ratio = contrastRatio(check.fg(theme.palette), check.bg(theme.palette));
          expect(ratio).not.toBeNull();
          expect(ratio!).toBeGreaterThanOrEqual(check.minRatio);
        });
      }
      for (const check of LARGE_CHECKS) {
        it(`${check.label} ≥ ${check.minRatio}:1 (large)`, () => {
          const ratio = contrastRatio(check.fg(theme.palette), check.bg(theme.palette));
          expect(ratio).not.toBeNull();
          expect(ratio!).toBeGreaterThanOrEqual(check.minRatio);
        });
      }
    });
  }
});
