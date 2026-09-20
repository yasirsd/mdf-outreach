import { alpha2ToAlpha3, alpha3ToAlpha2 } from "../../country";
import type { CountryAlpha2 } from "../../types";

export class BaciCountryCodeError extends Error {
  constructor(readonly value: string) {
    super("Unsupported BACI country code");
    this.name = "BaciCountryCodeError";
  }
}

/** MDF alpha-2 -> BotMarket's documented lowercase ISO alpha-3 wire value. */
export function toBaciCountryId(alpha2: CountryAlpha2): string {
  const alpha3 = alpha2ToAlpha3(alpha2);
  if (!alpha3) throw new BaciCountryCodeError(alpha2);
  return alpha3.toLowerCase();
}

/** BotMarket ISO alpha-3 (case-insensitive) -> MDF uppercase alpha-2. */
export function fromBaciCountryId(alpha3: string): CountryAlpha2 {
  const alpha2 = alpha3ToAlpha2(alpha3);
  if (!alpha2) throw new BaciCountryCodeError(alpha3);
  return alpha2.toUpperCase();
}
