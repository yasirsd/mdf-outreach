import type { ProductKey } from "@/lib/email/themes/types";
import type { AssetSlot } from "@/lib/types";

/**
 * The slot catalogue tells the Settings → Assets UI which slots each
 * product genuinely uses, whether they are required for production, and
 * whether they are decorative (alt text may be empty).
 *
 * Only slots listed here are surfaced in the asset manager. A slot that
 * is `required: true` will block a future live send if its asset is not
 * in `production` status.
 */
export interface SlotSpec {
  slot: AssetSlot;
  label: string;
  description: string;
  required: boolean;
  decorative?: boolean;
}

const SHARED_DECORATIVE: SlotSpec[] = [
  { slot: "texture", label: "Texture", description: "Subtle background texture used behind hero surfaces.", required: false, decorative: true },
  { slot: "divider", label: "Wave divider", description: "Curved divider between light and dark sections.", required: false, decorative: true },
  { slot: "doodle", label: "Doodle / line art", description: "Small product-inspired illustrative accent.", required: false, decorative: true },
];

export const SLOT_CATALOGUE: Record<ProductKey, SlotSpec[]> = {
  "guntur-chilli": [
    { slot: "hero", label: "Hero", description: "Primary hero image at the top of the email.", required: true },
    { slot: "macro", label: "Macro", description: "Close-up product photography for the product story.", required: false },
    { slot: "origin", label: "Origin", description: "Farm / origin photography (Guntur, Andhra Pradesh).", required: false },
    { slot: "stem", label: "Format · With Stem", description: "Whole chillies with stems.", required: false },
    { slot: "stemless", label: "Format · Stemless", description: "Whole chillies with stems removed.", required: false },
    { slot: "powder", label: "Format · Chilli Powder", description: "Ground chilli composition.", required: false },
    { slot: "packing", label: "Packing", description: "Export packing and labelling.", required: false },
    ...SHARED_DECORATIVE,
  ],
  "banganapalli-mango": [
    { slot: "hero", label: "Hero", description: "Primary hero image at the top of the email.", required: true },
    { slot: "macro", label: "Macro", description: "Close-up fruit photography.", required: false },
    { slot: "orchard", label: "Orchard", description: "Orchard / origin photography.", required: false },
    { slot: "variant_1", label: "Product · Whole fruit", description: "Whole Banganapalli fruit.", required: false },
    { slot: "packing", label: "Packing", description: "Export carton and labelling.", required: false },
    ...SHARED_DECORATIVE,
  ],
  pomegranate: [
    { slot: "hero", label: "Hero", description: "Primary hero image at the top of the email.", required: true },
    { slot: "macro", label: "Macro (arils)", description: "Close-up aril photography.", required: false },
    { slot: "variant_1", label: "Variety · Bhagwa", description: "Bhagwa variety photography.", required: false },
    { slot: "variant_2", label: "Variety · Ganesh", description: "Ganesh variety photography.", required: false },
    { slot: "packing", label: "Packing", description: "Export carton and labelling.", required: false },
    ...SHARED_DECORATIVE,
  ],
  "indian-apple": [
    { slot: "hero", label: "Hero", description: "Primary hero image at the top of the email.", required: true },
    { slot: "orchard", label: "Orchard", description: "Himachal orchard photography.", required: false },
    { slot: "variant_1", label: "Variety · Royal Delicious", description: "Royal Delicious photography.", required: false },
    { slot: "variant_2", label: "Variety · Red Delicious", description: "Red Delicious photography.", required: false },
    { slot: "variant_3", label: "Variety · Gala / Seasonal", description: "Gala or seasonal variety photography.", required: false },
    { slot: "packing", label: "Packing", description: "Export carton and labelling.", required: false },
    ...SHARED_DECORATIVE,
  ],
};

export function slotsFor(theme: ProductKey): SlotSpec[] {
  return SLOT_CATALOGUE[theme];
}

export function findSlotSpec(theme: ProductKey, slot: string): SlotSpec | undefined {
  return SLOT_CATALOGUE[theme]?.find((s) => s.slot === slot);
}
