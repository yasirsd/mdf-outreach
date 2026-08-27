/**
 * MDF Outreach — canonical buyer-type taxonomy.
 *
 * Persistence uses `label`. Existing free-text rows created before the
 * taxonomy landed are surfaced verbatim in the UI as
 * "Legacy · <value>" and preserved on unrelated saves.
 *
 * The `Other` bucket keeps the taxonomy honest — real buyers do not
 * always fit these categories.
 */

export interface BuyerTypeEntry {
  label: string;
  description?: string;
  isOther?: boolean;
}

export const BUYER_TYPES: BuyerTypeEntry[] = [
  { label: "Importer" },
  { label: "Distributor" },
  { label: "Wholesaler" },
  { label: "Retailer" },
  { label: "Trader" },
  { label: "Food Processor" },
  { label: "Manufacturer" },
  { label: "HORECA / Food Service", description: "Hotels, restaurants, caterers" },
  { label: "Broker / Agent" },
  { label: "Other", isOther: true },
];

export function findBuyerTypeByLabel(label: string | undefined | null): BuyerTypeEntry | undefined {
  if (!label) return undefined;
  const norm = label.trim().toLowerCase();
  return BUYER_TYPES.find((t) => t.label.toLowerCase() === norm);
}
