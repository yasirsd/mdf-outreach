/**
 * MDF Outreach — canonical MDF product catalogue.
 *
 * Distinct from `src/lib/email/themes/catalogue.ts` (which is bound to
 * email theme keys) so a business product can legitimately exist in
 * buyer / campaign data even before an approved email master has been
 * created for it.
 *
 * Every product here mirrors an entry in the email theme catalogue
 * today. That is intentional — the phase F5 audit found no legitimate
 * business product outside the email catalogue. New products should be
 * added HERE first and reference an emailThemeKey once (and if) an
 * email master is produced.
 */

import type { ProductKey } from "@/lib/email/themes/types";

export interface CatalogueProduct {
  id: string;
  displayName: string;
  shortName: string;
  /** Present when an approved email master exists for this product. */
  emailThemeKey: ProductKey | null;
  /** Coarse business category — matches email-theme catalogue for now. */
  category: "Spices" | "Fresh Produce";
  active: boolean;
}

export const PRODUCTS: CatalogueProduct[] = [
  {
    id: "guntur-dry-red-chilli",
    displayName: "Guntur Dry Red Chilli",
    shortName: "Guntur Chilli",
    emailThemeKey: "guntur-chilli",
    category: "Spices",
    active: true,
  },
  {
    id: "banganapalli-mango",
    displayName: "Banganapalli Mango",
    shortName: "Mango",
    emailThemeKey: "banganapalli-mango",
    category: "Fresh Produce",
    active: true,
  },
  {
    id: "indian-pomegranate",
    displayName: "Indian Pomegranate",
    shortName: "Pomegranate",
    emailThemeKey: "pomegranate",
    category: "Fresh Produce",
    active: true,
  },
  {
    id: "indian-apples",
    displayName: "Indian Apples",
    shortName: "Apples",
    emailThemeKey: "indian-apple",
    category: "Fresh Produce",
    active: true,
  },
];

export function findProductByDisplayName(
  name: string | undefined | null,
): CatalogueProduct | undefined {
  if (!name) return undefined;
  const norm = name.trim().toLowerCase();
  return PRODUCTS.find((p) => p.displayName.toLowerCase() === norm);
}

export function activeProducts(): CatalogueProduct[] {
  return PRODUCTS.filter((p) => p.active);
}
