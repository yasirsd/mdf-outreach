import { PRODUCT_THEMES } from "./registry";
import type { ProductKey, ProductTheme } from "./types";

export interface CatalogueEntry {
  key: ProductKey;
  name: string;
  category: string;
}

export const PRODUCT_CATALOGUE: CatalogueEntry[] = [
  { key: "guntur-chilli", name: "Guntur Dry Red Chilli", category: "Spices" },
  { key: "banganapalli-mango", name: "Banganapalli Mango", category: "Fresh Produce" },
  { key: "pomegranate", name: "Indian Pomegranate", category: "Fresh Produce" },
  { key: "indian-apple", name: "Indian Apples", category: "Fresh Produce" },
];

export const PRODUCT_CATEGORIES = ["Spices", "Fresh Produce"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export function catalogueByCategory(): Array<{ category: ProductCategory; products: CatalogueEntry[] }> {
  return PRODUCT_CATEGORIES.map((cat) => ({
    category: cat,
    products: PRODUCT_CATALOGUE.filter((p) => p.category === cat),
  }));
}

export function isProductKey(value: string | null | undefined): value is ProductKey {
  if (!value) return false;
  return value in PRODUCT_THEMES;
}

export function themeForKey(key: string | undefined | null): ProductTheme | null {
  if (!key || !isProductKey(key)) return null;
  return PRODUCT_THEMES[key];
}

/**
 * Guess a product theme key from free-text like a legacy campaign.product
 * value. Returns `null` when no confident match is found — never invents
 * a match. Used to help legacy campaigns settle into a product family on
 * first template pick.
 */
export function inferThemeKey(freeText: string | null | undefined): ProductKey | null {
  if (!freeText) return null;
  const s = freeText.toLowerCase();
  if (/chilli|chili|chile|guntur|mirchi|pepper/.test(s)) return "guntur-chilli";
  if (/mango|banganapalli|alphonso/.test(s)) return "banganapalli-mango";
  if (/pomegranate|anar/.test(s)) return "pomegranate";
  if (/apple/.test(s)) return "indian-apple";
  return null;
}
