import { randomUUID } from "node:crypto";
import type { EmailSection, EmailTemplate, TemplateVariant } from "@/lib/types";
import { getProductTheme } from "@/lib/email/themes/registry";
import type { ProductKey } from "@/lib/email/themes/types";

function id(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/*
 * All copy below is intentionally short so buyers can scan the email in
 * 5–10 seconds. The renderer handles hierarchy/spacing — do not add
 * long paragraphs here.
 */

interface DefaultCopyOverrides {
  introBody?: string;
  ctaHeadline?: string;
  ctaBody?: string;
  packingItems?: string[];
  whyPoints?: Array<{ title: string; body: string }>;
}

const OVERRIDES: Record<ProductKey, DefaultCopyOverrides> = {
  "guntur-chilli": {
    introBody:
      "MDF supplies Guntur dry red chilli from Andhra Pradesh for international buyers.\n\nWith stem, stemless and powder — packing tailored to your requirements.",
    ctaHeadline: "Looking for Guntur chilli supply?",
    ctaBody:
      "Tell us the format, quantity and destination market. We will confirm feasibility and share current commercial terms.",
    packingItems: [
      "Buyer-specified pack size",
      "Buyer-specified labelling",
      "Container or partial-load",
    ],
    whyPoints: [
      { title: "40+ years of family sourcing", body: "MDF grew from a family agricultural business established in 1984." },
      { title: "Buyer-led packing", body: "Format, pack size, and labelling prepared to your commercial requirement." },
      { title: "Direct export dialogue", body: "You speak with the MDF export team from first request through shipment." },
    ],
  },
  "banganapalli-mango": {
    introBody:
      "MDF coordinates Banganapalli mango shipments from Andhra Pradesh.\n\nSeason-aware planning, carton and labelling defined per buyer.",
    ctaHeadline: "Plan the Banganapalli season with MDF.",
    ctaBody:
      "Share your destination market and arrival window. We will confirm feasibility and share current commercial terms.",
    packingItems: [
      "Buyer-specified carton",
      "Season-aware planning",
      "Destination-market prep",
    ],
    whyPoints: [
      { title: "Andhra Pradesh sourcing", body: "Direct familiarity with the growing region for Banganapalli." },
      { title: "Season awareness", body: "Shipment planning built around the Banganapalli season and your arrival window." },
      { title: "Buyer-led preparation", body: "Carton, count, and labelling defined against your market's requirements." },
    ],
  },
  pomegranate: {
    introBody:
      "MDF coordinates Indian pomegranate shipments — Bhagwa and Ganesh varieties.\n\nSize grade and preparation defined per buyer.",
    ctaHeadline: "Discuss the pomegranate season with MDF.",
    ctaBody:
      "Share your variety preference, destination market, and arrival window. We will confirm feasibility and share current commercial terms.",
    packingItems: [
      "Buyer-specified count",
      "Buyer-specified labelling",
      "Season-aware planning",
    ],
    whyPoints: [
      { title: "Variety-specific selection", body: "Bhagwa or Ganesh — matched against what the destination market wants." },
      { title: "Buyer-led preparation", body: "Carton, count, and labelling defined to your market." },
      { title: "40+ years of family sourcing", body: "MDF grew from a family agricultural business established in 1984." },
    ],
  },
  "indian-apple": {
    introBody:
      "MDF coordinates Indian apple shipments from Himalayan-belt orchards.\n\nVariety and grade confirmed per season and campaign.",
    ctaHeadline: "Plan the Indian apple season with MDF.",
    ctaBody:
      "Share your variety preference, destination market, and arrival window. We will confirm feasibility and share current commercial terms.",
    packingItems: [
      "Buyer-specified grade",
      "Buyer-specified labelling",
      "Season-aware planning",
    ],
    whyPoints: [
      { title: "Season-aware variety", body: "We confirm variety and grade against the harvest window and your arrival requirement." },
      { title: "Buyer-led preparation", body: "Grade, count, and labelling defined against your market's requirements." },
      { title: "Direct export dialogue", body: "You speak with the MDF export team, no reseller layer." },
    ],
  },
};

function signatureSections(themeKey: ProductKey): EmailSection[] {
  const theme = getProductTheme(themeKey);
  const c = theme.copy;
  const o = OVERRIDES[themeKey];
  return [
    {
      id: id("intro"),
      type: "intro",
      visible: true,
      data: {
        greeting: "{{greeting}},",
        body: o.introBody ?? "",
      },
    },
    {
      id: id("hero"),
      type: "hero",
      visible: true,
      data: {
        eyebrow: c.eyebrow,
        headline: c.heroHeadline,
        body: shortHeroBody(themeKey),
        ctaLabel: c.ctaLabel,
        ctaUrl: "",
      },
    },
    {
      id: id("heritage"),
      type: "heritage",
      visible: true,
      data: {
        big: "40+",
        title: "Years of Agricultural Excellence",
        body: "Roots in the MD Fruits family business, established 1984.",
      },
    },
    {
      id: id("origin"),
      type: "origin",
      visible: true,
      data: {
        headline: c.originHeadline,
        body: shortOriginBody(themeKey),
      },
    },
    {
      id: id("formats"),
      type: "formats",
      visible: true,
      data: {
        headline: c.formatsHeadline,
        format1Title: c.formats[0]?.title ?? "",
        format1Body: shortFormat(c.formats[0]?.body ?? ""),
        format2Title: c.formats[1]?.title ?? "",
        format2Body: shortFormat(c.formats[1]?.body ?? ""),
        format3Title: c.formats[2]?.title ?? "",
        format3Body: shortFormat(c.formats[2]?.body ?? ""),
      },
    },
    {
      id: id("packing"),
      type: "packing",
      visible: true,
      data: {
        headline: "Packed for your market.",
        body: "Packing and labelling can be tailored to buyer requirements.",
        item1: o.packingItems?.[0] ?? "",
        item2: o.packingItems?.[1] ?? "",
        item3: o.packingItems?.[2] ?? "",
        ctaLabel: c.ctaLabel,
        ctaUrl: "",
      },
    },
    {
      id: id("why"),
      type: "why",
      visible: true,
      data: {
        headline: "Why MDF.",
        p1Title: o.whyPoints?.[0]?.title ?? "",
        p1Body: o.whyPoints?.[0]?.body ?? "",
        p2Title: o.whyPoints?.[1]?.title ?? "",
        p2Body: o.whyPoints?.[1]?.body ?? "",
        p3Title: o.whyPoints?.[2]?.title ?? "",
        p3Body: o.whyPoints?.[2]?.body ?? "",
      },
    },
    {
      id: id("cta"),
      type: "cta",
      visible: true,
      data: {
        headline: o.ctaHeadline ?? c.ctaHeadline,
        body: o.ctaBody ?? c.ctaBody,
        ctaLabel: c.ctaLabel,
        ctaUrl: "",
        secondaryLabel: "Reply to this email",
        secondaryUrl: "",
        footnote: "MD Fruits · Family agricultural business since 1984",
      },
    },
    { id: id("footer"), type: "footer", visible: true, data: {} },
  ];
}

function directSections(themeKey: ProductKey): EmailSection[] {
  const theme = getProductTheme(themeKey);
  const c = theme.copy;
  return [
    {
      id: id("intro"),
      type: "intro",
      visible: true,
      data: {
        greeting: "{{greeting}},",
        body: c.directBody,
      },
    },
    {
      id: id("hero"),
      type: "hero",
      visible: true,
      data: {
        eyebrow: c.eyebrow,
        headline: c.directHeadline,
        // Direct renderer converts this line-broken list into pill chips.
        body: c.directPoints.join("\n"),
        ctaLabel: c.ctaLabel,
        ctaUrl: "",
      },
    },
    { id: id("heritage"), type: "heritage", visible: false, data: {
        big: "40+",
        title: "Years of Agricultural Excellence",
        body: "Roots in the MD Fruits family business, established 1984.",
      } },
    { id: id("origin"), type: "origin", visible: false, data: {} },
    { id: id("formats"), type: "formats", visible: false, data: {} },
    { id: id("packing"), type: "packing", visible: false, data: {} },
    { id: id("why"), type: "why", visible: false, data: {} },
    {
      id: id("cta"),
      type: "cta",
      visible: true,
      data: {
        ctaLabel: c.ctaLabel,
        ctaUrl: "",
      },
    },
    { id: id("footer"), type: "footer", visible: true, data: {} },
  ];
}

/* Small helpers that trim overly long copy in the theme registry to
 * suit the modern renderer's tighter typography. */
function shortHeroBody(k: ProductKey): string {
  switch (k) {
    case "guntur-chilli":
      return "Selected at the Guntur yard for cut, colour and heat. Prepared to your commercial specification.";
    case "banganapalli-mango":
      return "Season-aware planning, carton and labelling defined per buyer.";
    case "pomegranate":
      return "Bhagwa and Ganesh — size grade and preparation defined per buyer.";
    case "indian-apple":
      return "Royal Delicious, Red Delicious, Gala and seasonal Himachal / Kinnaur varieties.";
  }
}

function shortOriginBody(k: ProductKey): string {
  switch (k) {
    case "guntur-chilli":
      return "India's most important dry red chilli region. Sourced directly against the buyer's brief.";
    case "banganapalli-mango":
      return "Named after the town in Nandyal district. Defined season, clean shape.";
    case "pomegranate":
      return "Grown across India's arid pomegranate belt with established export experience.";
    case "indian-apple":
      return "Himachal Pradesh and neighbouring Himalayan-belt orchards. Season-aware sourcing.";
  }
}

function shortFormat(body: string): string {
  // Take the first sentence only.
  const first = body.split(/\.\s/)[0].trim();
  return first.endsWith(".") ? first : `${first}.`;
}

/* -------------------------------------------------------------------- */

export function buildProductTemplate(
  themeKey: ProductKey,
  variant: TemplateVariant,
): EmailTemplate {
  const theme = getProductTheme(themeKey);
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: `${theme.name} — ${variant === "signature" ? "Signature" : "Direct"}`,
    label: variant === "signature" ? "Signature" : "Direct",
    sections: variant === "signature" ? signatureSections(themeKey) : directSections(themeKey),
    themeKey,
    variant,
    version: 1,
    status: "approved",
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function allProductionTemplates(): EmailTemplate[] {
  const order: Array<[ProductKey, TemplateVariant]> = [
    ["guntur-chilli", "signature"],
    ["guntur-chilli", "direct"],
    ["banganapalli-mango", "signature"],
    ["banganapalli-mango", "direct"],
    ["pomegranate", "signature"],
    ["pomegranate", "direct"],
    ["indian-apple", "signature"],
    ["indian-apple", "direct"],
  ];
  return order.map(([k, v]) => buildProductTemplate(k, v));
}
