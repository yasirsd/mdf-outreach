import { describe, expect, it } from "vitest";
import {
  activeBusinessProducts,
  businessProductIdToEmailThemeKey,
  findBusinessProductByEmailThemeKey,
  findBusinessProductById,
  isActiveBusinessProductId,
} from "./businessCatalogue";
import { PRODUCTS } from "@/lib/catalogue/products";

describe("BF2 business catalogue bridge", () => {
  it("delegates active products to src/lib/catalogue/products.ts", () => {
    const from = activeBusinessProducts().map((p) => p.id).sort();
    const expected = PRODUCTS.filter((p) => p.active)
      .map((p) => p.id)
      .sort();
    expect(from).toEqual(expected);
  });

  it("findBusinessProductById resolves canonical ids", () => {
    expect(findBusinessProductById("guntur-dry-red-chilli")?.displayName).toBe(
      "Guntur Dry Red Chilli",
    );
    expect(findBusinessProductById("banganapalli-mango")?.displayName).toBe(
      "Banganapalli Mango",
    );
    expect(findBusinessProductById("indian-pomegranate")?.displayName).toBe(
      "Indian Pomegranate",
    );
    expect(findBusinessProductById("indian-apples")?.displayName).toBe("Indian Apples");
  });

  it("returns undefined for unknown / inactive / empty inputs", () => {
    expect(findBusinessProductById(undefined)).toBeUndefined();
    expect(findBusinessProductById(null)).toBeUndefined();
    expect(findBusinessProductById("")).toBeUndefined();
    expect(findBusinessProductById("cardamom-legacy")).toBeUndefined();
    expect(isActiveBusinessProductId("cardamom-legacy")).toBe(false);
    expect(isActiveBusinessProductId(undefined)).toBe(false);
  });

  it("bridges business id → email theme ProductKey (the only allowed direction)", () => {
    expect(businessProductIdToEmailThemeKey("guntur-dry-red-chilli")).toBe(
      "guntur-chilli",
    );
    expect(businessProductIdToEmailThemeKey("banganapalli-mango")).toBe(
      "banganapalli-mango",
    );
    expect(businessProductIdToEmailThemeKey("indian-pomegranate")).toBe("pomegranate");
    expect(businessProductIdToEmailThemeKey("indian-apples")).toBe("indian-apple");
    expect(businessProductIdToEmailThemeKey("cardamom-legacy")).toBeUndefined();
  });

  it("findBusinessProductByEmailThemeKey exists only as a display-side reverse lookup", () => {
    expect(findBusinessProductByEmailThemeKey("guntur-chilli")?.id).toBe(
      "guntur-dry-red-chilli",
    );
    expect(findBusinessProductByEmailThemeKey("pomegranate")?.id).toBe(
      "indian-pomegranate",
    );
    expect(findBusinessProductByEmailThemeKey("unknown-theme")).toBeUndefined();
  });
});
