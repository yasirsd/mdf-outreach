import type { ProductKey, ProductTheme } from "./types";

/**
 * MDF product themes.
 *
 * Every palette is a full visual system, not just a colour swap:
 *   - `canvas` sits behind the email card (per product)
 *   - `paper` is the card body
 *   - `darkSurface` is the hero / packing / CTA dark band
 *   - `primary` is the product-signature colour (chilli red, mango gold,
 *      ruby, apple red) — used for eyebrows, dividers, and the heritage
 *      `40+` numeral
 *   - `ctaBg` / `ctaText` drive the primary CTA button
 *
 * Every foreground/background pair is verified against WCAG AA by
 * `contrast.test.ts`. Adjust with care — the test will fail if any
 * body-copy pair drops below 4.5:1 or any CTA below AA.
 */

const SHARED_ACCENT = "#E95D24"; // MDF orange — used as small brand accent, never dominant
const SHARED_ACCENT_TEXT = "#0B0B0B";

export const PRODUCT_THEMES: Record<ProductKey, ProductTheme> = {
  /* -------------------------------------------------------------------- */
  /*  GUNTUR — bold, earthy, hot, editorial                              */
  /* -------------------------------------------------------------------- */
  "guntur-chilli": {
    key: "guntur-chilli",
    name: "Guntur Dry Red Chilli",
    category: "Spices",
    origin: "Guntur, Andhra Pradesh · India",
    heroMode: "dark",
    palette: {
      canvas: "#E9E1D5",

      paper: "#F6EFE5",
      paperText: "#211511",
      paperMuted: "#75655D",

      surface: "#EFE7D7",
      surfaceText: "#211511",
      surfaceMuted: "#75655D",

      darkSurface: "#24110E",
      darkSurfaceText: "#FFF4E8",
      darkSurfaceMuted: "#C9B29E",

      primary: "#8F1F18",
      accent: SHARED_ACCENT,
      accentText: SHARED_ACCENT_TEXT,

      ctaBg: "#B72A21",
      ctaText: "#FFFFFF",

      border: "#D9CFBB",

      ink: "#24110E",
      soft: "#EFE7D7",
      primaryDeep: "#641611",
      text: "#211511",
      textMuted: "#75655D",
      invertedText: "#FFF4E8",
      invertedMuted: "#C9B29E",
    },
    copy: {
      eyebrow: "Guntur Dry Red Chilli · From India",
      heroHeadline: "Guntur Chilli.\nGrown where heat has heritage.",
      heroBody:
        "For four decades our family has worked with Guntur farmers to source dry red chilli with dependable colour, cut and heat.",
      heritageTitle: "Years of Agricultural Excellence",
      heritageBody: "Roots in the MD Fruits family business, established 1984.",
      originHeadline: "Sourced from Guntur, Andhra Pradesh.",
      originBody:
        "Guntur is India's most important dry red chilli producing region. Lots are selected at the mirchi yard for cut, colour and heat.",
      formatsHeadline: "Available formats.",
      formats: [
        { title: "With Stem", body: "Whole chillies with the stem intact.", assetSlot: "stem" },
        { title: "Stemless", body: "Convenient for reprocessing and grinding.", assetSlot: "stemless" },
        { title: "Chilli Powder", body: "Ground to the mesh and heat you specify.", assetSlot: "powder" },
      ],
      packingHeadline: "Packed for your market.",
      packingBody: "Packing and labelling can be tailored to buyer requirements.",
      packingItems: [
        "Buyer-specified pack size",
        "Buyer-specified labelling",
        "Container or partial-load",
      ],
      whyHeadline: "Why buyers work with MDF.",
      whyPoints: [
        { title: "40+ years of family sourcing", body: "MDF grew from a family agricultural business established in 1984." },
        { title: "Buyer-led packing", body: "Format, pack size, and labelling prepared to your commercial requirement." },
        { title: "Direct export dialogue", body: "You speak with the MDF export team from first request through shipment." },
      ],
      ctaHeadline: "Looking for Guntur chilli supply?",
      ctaBody:
        "Tell us the format, quantity and destination market. We will confirm feasibility and share current commercial terms.",
      ctaLabel: "Request price & specs",
      directHeadline: "Guntur Dry Red Chilli — direct from India.",
      directBody:
        "MDF supplies Guntur dry red chilli in with-stem, stemless and powder formats, with buyer-defined packing and labelling.",
      directPoints: [
        "With Stem · Stemless · Chilli Powder",
        "Buyer-specified pack size and labelling",
        "Sourced at the Guntur mirchi yard",
        "40+ years of family sourcing (Since 1984)",
      ],
    },
  },

  /* -------------------------------------------------------------------- */
  /*  MANGO — warm, fresh, sunlit, orchard                                */
  /* -------------------------------------------------------------------- */
  "banganapalli-mango": {
    key: "banganapalli-mango",
    name: "Banganapalli Mango",
    category: "Fresh Produce",
    origin: "Andhra Pradesh · India",
    heroMode: "dark",
    palette: {
      canvas: "#EFE8D8",

      paper: "#FFF5DF",
      paperText: "#282116",
      paperMuted: "#746650",

      surface: "#F4E7C7",
      surfaceText: "#282116",
      surfaceMuted: "#746650",

      // Deep orchard leaf — the mango hero surface.
      darkSurface: "#173525",
      darkSurfaceText: "#FFF6DC",
      darkSurfaceMuted: "#D6C58F",

      primary: "#B36F1C", // mango gold visible on cream
      accent: SHARED_ACCENT,
      accentText: SHARED_ACCENT_TEXT,

      // CTA: darker mango gold on cream text (AA verified).
      ctaBg: "#8E5615",
      ctaText: "#FFF6DC",

      border: "#D8C79B",

      ink: "#173525",
      soft: "#F4E7C7",
      // Deeper leaf — used by the packing dark band.
      primaryDeep: "#0E2418",
      text: "#282116",
      textMuted: "#746650",
      invertedText: "#FFF6DC",
      invertedMuted: "#D6C58F",
    },
    copy: {
      eyebrow: "Banganapalli Mango · From India",
      heroHeadline: "Banganapalli Mango.\nIndia's summer, ready for your market.",
      heroBody:
        "Golden, firm, generous. We coordinate sourcing and shipment planning so a serious importer can present this classic Indian mango in season.",
      heritageTitle: "Years of Agricultural Excellence",
      heritageBody: "Roots in the MD Fruits family business, established 1984.",
      originHeadline: "From the orchards of Andhra Pradesh.",
      originBody:
        "Banganapalli takes its name from the town in Nandyal district. A defined season, clean shape and dependable ripening character.",
      formatsHeadline: "Commercial options.",
      formats: [
        { title: "Seasonal Whole Fruit", body: "Selected against the size and ripening stage requested.", assetSlot: "hero" },
        { title: "Buyer-defined Pack", body: "Standard cartons or a pack format specified by the importer.", assetSlot: "packing" },
        { title: "Coordinated Shipment", body: "Season-aware planning against your arrival window.", assetSlot: "origin" },
      ],
      packingHeadline: "Packed for your market.",
      packingBody: "Pack size, count, labelling and shipping marks are defined per buyer.",
      packingItems: [
        "Buyer-specified carton and count",
        "Buyer-specified labelling",
        "Season-aware planning",
      ],
      whyHeadline: "Why buyers work with MDF.",
      whyPoints: [
        { title: "Andhra Pradesh sourcing", body: "Direct familiarity with the Banganapalli growing region." },
        { title: "Season awareness", body: "Shipment planning built around the season and your arrival window." },
        { title: "Buyer-led preparation", body: "Carton, count, and labelling defined to your market." },
      ],
      ctaHeadline: "Plan the Banganapalli season with MDF.",
      ctaBody:
        "Share your destination market and the arrival window you want. We will confirm feasibility and share current commercial terms.",
      ctaLabel: "Request price & specs",
      directHeadline: "Banganapalli Mango — sourced from Andhra Pradesh.",
      directBody:
        "MDF coordinates seasonal Banganapalli mango shipments to international buyers.",
      directPoints: [
        "Andhra Pradesh Banganapalli, in season",
        "Buyer-specified carton and labelling",
        "Season-aware shipment planning",
        "40+ years of family sourcing (Since 1984)",
      ],
    },
  },

  /* -------------------------------------------------------------------- */
  /*  POMEGRANATE — jewel-like, rich, botanical                           */
  /* -------------------------------------------------------------------- */
  pomegranate: {
    key: "pomegranate",
    name: "Indian Pomegranate",
    category: "Fresh Produce",
    origin: "India",
    heroMode: "dark",
    palette: {
      canvas: "#EDE4E1",

      paper: "#F8EEEB",
      paperText: "#24171A",
      paperMuted: "#786065",

      surface: "#EFD9D2",
      surfaceText: "#24171A",
      surfaceMuted: "#5C4045",

      darkSurface: "#261318",
      darkSurfaceText: "#FFF1EE",
      darkSurfaceMuted: "#CFAAA7",

      primary: "#A3324B", // ruby — visible on blush ivory
      accent: SHARED_ACCENT,
      accentText: SHARED_ACCENT_TEXT,

      ctaBg: "#681C2A", // burgundy CTA
      ctaText: "#FFF1EE",

      border: "#D9BFB7",

      ink: "#261318",
      soft: "#EFD9D2",
      primaryDeep: "#4A0F1A",
      text: "#24171A",
      textMuted: "#786065",
      invertedText: "#FFF1EE",
      invertedMuted: "#CFAAA7",
    },
    copy: {
      eyebrow: "Indian Pomegranate · From India",
      heroHeadline: "Pomegranate.\nRuby-red fruit from India's arid belt.",
      heroBody:
        "Bhagwa and Ganesh — size grade and preparation defined per buyer.",
      heritageTitle: "Years of Agricultural Excellence",
      heritageBody: "Roots in the MD Fruits family business, established 1984.",
      originHeadline: "India's pomegranate belt.",
      originBody:
        "Grown across India's arid belt with established export experience. Variety, size grade, and preparation matched to the destination market.",
      formatsHeadline: "Varieties and preparation.",
      formats: [
        { title: "Bhagwa", body: "Recognised export variety, confirmed per campaign.", assetSlot: "hero" },
        { title: "Ganesh", body: "Recognised Indian pomegranate variety.", assetSlot: "hero" },
        { title: "Buyer-defined Pack", body: "Carton, count, and labelling defined per buyer.", assetSlot: "packing" },
      ],
      packingHeadline: "Packed for your market.",
      packingBody: "Count per carton, unit weight, labelling, and destination market are defined per buyer.",
      packingItems: [
        "Buyer-specified count",
        "Buyer-specified labelling",
        "Season-aware planning",
      ],
      whyHeadline: "Why buyers work with MDF.",
      whyPoints: [
        { title: "Variety-specific selection", body: "Bhagwa or Ganesh — matched to what the destination market wants." },
        { title: "Buyer-led preparation", body: "Carton, count, and labelling defined to your market." },
        { title: "Direct export dialogue", body: "You speak with the MDF export team, no reseller layer." },
      ],
      ctaHeadline: "Discuss the pomegranate season with MDF.",
      ctaBody:
        "Share your variety preference, destination market, and arrival window.",
      ctaLabel: "Request price & specs",
      directHeadline: "Indian Pomegranate — Bhagwa or Ganesh.",
      directBody:
        "MDF coordinates pomegranate shipments to international buyers with variety-specific selection.",
      directPoints: [
        "Bhagwa · Ganesh (confirmed per campaign)",
        "Buyer-specified carton and labelling",
        "Season-aware shipment planning",
        "40+ years of family sourcing (Since 1984)",
      ],
    },
  },

  /* -------------------------------------------------------------------- */
  /*  APPLE — crisp, fresh, orchard, precise                              */
  /* -------------------------------------------------------------------- */
  "indian-apple": {
    key: "indian-apple",
    name: "Indian Apples",
    category: "Fresh Produce",
    origin: "Himachal Pradesh · India",
    heroMode: "dark",
    palette: {
      canvas: "#E8E8DE",

      paper: "#F6F4E8",
      paperText: "#171B17",
      paperMuted: "#62685F",

      surface: "#DCE4D5",
      surfaceText: "#171B17",
      surfaceMuted: "#4A554B",

      darkSurface: "#132019",
      darkSurfaceText: "#F7F6EC",
      darkSurfaceMuted: "#B5C4A6",

      primary: "#AE3A32", // apple red
      accent: SHARED_ACCENT,
      accentText: SHARED_ACCENT_TEXT,

      ctaBg: "#AE3A32", // apple red CTA
      ctaText: "#F7F6EC",

      border: "#C1CBAE",

      ink: "#132019",
      soft: "#DCE4D5",
      primaryDeep: "#203B2C", // orchard green — packing dark band uses this
      text: "#171B17",
      textMuted: "#62685F",
      invertedText: "#F7F6EC",
      invertedMuted: "#B5C4A6",
    },
    copy: {
      eyebrow: "Indian Apples · From the Himalayan foothills",
      heroHeadline: "Indian Apples.\nOrchard-sourced from the Himalayan foothills.",
      heroBody:
        "Royal Delicious, Red Delicious, Gala and seasonal Himachal / Kinnaur varieties.",
      heritageTitle: "Years of Agricultural Excellence",
      heritageBody: "Roots in the MD Fruits family business, established 1984.",
      originHeadline: "Himalayan orchards.",
      originBody:
        "Sourced from Himachal Pradesh and neighbouring Himalayan-belt orchards. Harvest and variety confirmed per campaign.",
      formatsHeadline: "Varieties and grades.",
      formats: [
        { title: "Royal Delicious", body: "Recognised Indian apple variety.", assetSlot: "hero" },
        { title: "Red Delicious", body: "Recognised Indian apple variety.", assetSlot: "hero" },
        { title: "Gala / Seasonal", body: "Gala and seasonal Himachal / Kinnaur varieties.", assetSlot: "hero" },
      ],
      packingHeadline: "Packed for your market.",
      packingBody: "Grade, count per carton, labelling, and shipping marks defined per buyer.",
      packingItems: [
        "Buyer-specified grade",
        "Buyer-specified labelling",
        "Season-aware planning",
      ],
      whyHeadline: "Why buyers work with MDF.",
      whyPoints: [
        { title: "Season-aware variety", body: "Variety and grade confirmed against the harvest window and your arrival requirement." },
        { title: "Buyer-led preparation", body: "Grade, count, and labelling defined to your market." },
        { title: "Direct export dialogue", body: "You speak with the MDF export team, no reseller layer." },
      ],
      ctaHeadline: "Plan the Indian apple season with MDF.",
      ctaBody:
        "Share your variety preference, destination market, and arrival window.",
      ctaLabel: "Request price & specs",
      directHeadline: "Indian Apples — orchard-sourced.",
      directBody:
        "MDF coordinates Indian apple shipments — Royal Delicious, Red Delicious, Gala and seasonal Himachal / Kinnaur varieties.",
      directPoints: [
        "Royal Delicious · Red Delicious · Gala · Seasonal",
        "Buyer-specified grade and labelling",
        "Season-aware shipment planning",
        "40+ years of family sourcing (Since 1984)",
      ],
    },
  },
};

export function getProductTheme(key: ProductKey): ProductTheme {
  return PRODUCT_THEMES[key];
}
