import type { EmailSection, EmailTemplate } from "@/lib/types";

export const DEFAULT_TEMPLATE_ID = "tpl-mdf-guntur-premium";

export function createDefaultSections(): EmailSection[] {
  return [
    {
      id: "sec-intro",
      type: "intro",
      visible: true,
      data: {
        greeting: "{{greeting}},",
        body:
          "I'm reaching out from MDF Exports & Imports in Andhra Pradesh, India. We supply Guntur dry red chilli for international buyers in stem, stemless and powder formats, with packing tailored to buyer requirements.",
      },
    },
    {
      id: "sec-hero",
      type: "hero",
      visible: true,
      data: {
        eyebrow: "GUNTUR · ANDHRA PRADESH · INDIA",
        headline: "Guntur Chilli.\nGrown Where Heat Has Heritage.",
        body:
          "Premium Guntur dry red chilli sourced from Andhra Pradesh and prepared for international buyers.",
        ctaLabel: "REQUEST PRICE & SPECS",
        ctaUrl: "https://www.mdfexport.com/enquire",
      },
    },
    {
      id: "sec-heritage",
      type: "heritage",
      visible: true,
      data: {
        big: "40+",
        title: "Years of Agricultural Excellence",
        body:
          "MDF Exports & Imports grew from MD Fruits, our family agricultural business established in 1984.",
      },
    },
    {
      id: "sec-origin",
      type: "origin",
      visible: true,
      data: {
        headline: "From Guntur.\nTo the World.",
        body:
          "MDF sources Guntur dry red chilli from Andhra Pradesh — one of India's most respected chilli-growing regions — and prepares it for international buyers.",
      },
    },
    {
      id: "sec-formats",
      type: "formats",
      visible: true,
      data: {
        headline: "Your Chilli.\nYour Specification.",
        format1Title: "WITH STEM",
        format1Body: "Whole dry red chilli with stems intact.",
        format2Title: "STEMLESS",
        format2Body: "Stem-removed dry red chilli, prepared to buyer specification.",
        format3Title: "CHILLI POWDER",
        format3Body: "Processed chilli powder ground to customer specification.",
      },
    },
    {
      id: "sec-packing",
      type: "packing",
      visible: true,
      data: {
        headline: "Packed for\nYour Market.",
        body:
          "Packing and labelling can be tailored to your commercial requirements — from bulk jute to retail-ready formats.",
        item1: "Custom Packing",
        item2: "Private Labelling",
        item3: "Buyer-Specific Requirements",
        ctaLabel: "DISCUSS YOUR REQUIREMENT",
        ctaUrl: "https://www.mdfexport.com/enquire",
      },
    },
    {
      id: "sec-why",
      type: "why",
      visible: true,
      data: {
        headline: "Why MDF?",
        p1Title: "40+ Years Heritage",
        p1Body: "Agricultural experience rooted in MD Fruits since 1984.",
        p2Title: "Source Knowledge",
        p2Body: "Strong familiarity with agricultural sourcing across Andhra Pradesh.",
        p3Title: "Buyer-Specific Preparation",
        p3Body: "Product preparation aligned with your commercial requirements.",
        p4Title: "Custom Packing",
        p4Body: "Packing and labelling options for international buyers.",
        p5Title: "Export Support",
        p5Body: "Coordination and documentation support through shipment.",
      },
    },
    {
      id: "sec-cta",
      type: "cta",
      visible: true,
      data: {
        headline: "Looking for a reliable\nGuntur chilli supplier?",
        body:
          "Tell us your required chilli type, quantity, destination and packing preference — we'll respond with current specifications and pricing.",
        ctaLabel: "GET PRICE & SPECIFICATIONS",
        ctaUrl: "https://www.mdfexport.com/enquire",
        secondaryLabel: "WhatsApp Export Team",
        secondaryUrl: "https://wa.me/919999999999",
        footnote: "Bulk & commercial enquiries welcome.",
      },
    },
    {
      id: "sec-footer",
      type: "footer",
      visible: true,
      data: {},
    },
  ];
}

export function createDefaultTemplate(): EmailTemplate {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_TEMPLATE_ID,
    name: "Guntur Chilli — Premium",
    label: "MDF Master Template",
    sections: createDefaultSections(),
    createdAt: now,
    updatedAt: now,
    isDemo: true,
  };
}
