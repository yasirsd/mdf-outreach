export const PRODUCT_KEYS = [
  "guntur-chilli",
  "banganapalli-mango",
  "pomegranate",
  "indian-apple",
] as const;
export type ProductKey = (typeof PRODUCT_KEYS)[number];

export type TemplateVariant = "signature" | "direct";

export type TemplateStatus = "draft" | "approved" | "archived";

/**
 * ProductPalette expresses colours as explicit foreground/background PAIRS.
 *
 * Every renderer surface must consume a paired role — the renderer must
 * never pick a foreground colour ad hoc from the palette. This is what
 * guarantees readable contrast on every template.
 *
 * Roles:
 *   paper         → the email card's warm ivory background
 *   paperText     → primary body text on paper
 *   paperMuted    → secondary body text on paper (WCAG AA verified)
 *
 *   surface       → a softer tinted card sitting on paper (product-tinted)
 *   surfaceText   → primary text on surface
 *   surfaceMuted  → secondary text on surface
 *
 *   darkSurface   → the deep hero / CTA surface (product ink or product-deep)
 *   darkSurfaceText   → primary text on darkSurface (ivory / white)
 *   darkSurfaceMuted  → secondary text on darkSurface (still readable)
 *
 *   primary       → strong product accent (used for eyebrows/dividers only,
 *                   NEVER as a background under paperMuted-type text)
 *   accent        → CTA button background
 *   accentText    → CTA button label colour (verified against `accent`)
 *
 *   border        → hairline separator on paper
 */
export interface ProductPalette {
  /** Outer inbox canvas — the background the email card sits on. Per product. */
  canvas: string;

  paper: string;
  paperText: string;
  paperMuted: string;

  surface: string;
  surfaceText: string;
  surfaceMuted: string;

  darkSurface: string;
  darkSurfaceText: string;
  darkSurfaceMuted: string;

  primary: string;
  accent: string;
  accentText: string;

  /** Product-specific CTA button colour. Distinct from `accent`. */
  ctaBg: string;
  ctaText: string;

  border: string;

  /**
   * Historic aliases retained so any transitional code that still references
   * `ink`, `text`, `invertedText`, etc. continues to compile. New code
   * MUST use the explicit paired roles above.
   */
  ink: string;
  soft: string;
  primaryDeep: string;
  text: string;
  textMuted: string;
  invertedText: string;
  invertedMuted: string;
}

/** Which mode a hero should render — never inferred from palette. */
export type HeroMode = "dark" | "light";

export interface ProductThemeCopy {
  eyebrow: string;
  heroHeadline: string;
  heroBody: string;
  heritageTitle: string;
  heritageBody: string;
  originHeadline: string;
  originBody: string;
  formatsHeadline: string;
  formats: Array<{ title: string; body: string; assetSlot: string }>;
  packingHeadline: string;
  packingBody: string;
  packingItems: string[];
  whyHeadline: string;
  whyPoints: Array<{ title: string; body: string }>;
  ctaHeadline: string;
  ctaBody: string;
  ctaLabel: string;
  directHeadline: string;
  directBody: string;
  directPoints: string[];
}

export interface ProductTheme {
  key: ProductKey;
  name: string;
  category: string;
  origin: string;
  palette: ProductPalette;
  heroMode: HeroMode;
  copy: ProductThemeCopy;
}
