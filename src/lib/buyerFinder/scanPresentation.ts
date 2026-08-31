import { findCountryByName } from "@/lib/catalogue/countries";
import { productMatchStrengthLabel } from "./scorePresentation";
import type { BuyerCandidateProductMatch } from "./types";

const CODE_SHORT: Record<string, string> = {
  AE: "UAE",
  GB: "UK",
  US: "US",
};

export function countryScanLabel(country: string | null | undefined): string {
  if (!country) return "—";
  const found = findCountryByName(country);
  if (found && CODE_SHORT[found.code]) return CODE_SHORT[found.code];
  return country;
}

export function productMatchScanLabel(match: BuyerCandidateProductMatch): string {
  const full = productMatchStrengthLabel(match);
  if (full === "Directory keyword match") return "Directory signal";
  return full;
}
