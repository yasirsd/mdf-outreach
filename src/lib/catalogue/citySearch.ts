"use server";

import { cityMapping } from "city-timezones";
import { codeForCountryName } from "./countries";

/**
 * MDF Outreach — server-side city search.
 *
 * PHASE F5 FOLLOW-UP CONTRACT:
 *   • Country-scoped: caller passes the CANONICAL COUNTRY NAME the
 *     buyer is in (matches how buyers.country is persisted). We map
 *     it to ISO-3166 alpha-2 to query city-timezones.
 *   • NEVER ship the global city dataset to the client. This file is
 *     `"use server"` so Next.js emits it as a server-only chunk.
 *   • Custom entries remain the primary path — the Combobox in
 *     BuyerForm accepts any typed value if none of the suggestions fit.
 *
 * Data source: `city-timezones` (MIT license). ~7,300 cities across
 * 220+ countries. Includes `province` for disambiguation and `iso2`
 * for country scoping. Installed footprint ~1.9 MB, kept server-side.
 */

export interface CitySearchInput {
  country?: string | null;
  query: string;
}

export interface CityResult {
  name: string;
  admin?: string;
}

const MIN_QUERY = 1;
const RESULT_LIMIT = 20;

export async function searchCitiesAction(
  input: CitySearchInput,
): Promise<CityResult[]> {
  const q = (input.query ?? "").trim();
  if (q.length < MIN_QUERY) return [];
  const iso2 = codeForCountryName(input.country ?? "");
  // Legacy / unknown country → no suggestions; the combobox still
  // accepts custom entries.
  if (!iso2) return [];

  const needle = q.toLowerCase();
  const prefix: Array<{ name: string; admin?: string }> = [];
  const substring: Array<{ name: string; admin?: string }> = [];

  for (const row of cityMapping as ReadonlyArray<{
    city: string;
    city_ascii?: string;
    iso2: string;
    province?: string;
  }>) {
    if (row.iso2 !== iso2) continue;
    const name = row.city;
    const nameLc = name.toLowerCase();
    if (nameLc.startsWith(needle)) {
      prefix.push({ name, admin: row.province });
    } else if (nameLc.includes(needle)) {
      substring.push({ name, admin: row.province });
    }
    if (prefix.length >= RESULT_LIMIT) break;
  }

  // Deduplicate by the (name + admin) identity so that
  //   Springfield / Illinois   and
  //   Springfield / Massachusetts
  // remain DISTINCT rows for the operator to pick between, while
  // literal duplicate records (same city AND same admin) collapse.
  // Country scoping is already applied above; this dedupe is purely
  // an in-country tiebreaker.
  const seen = new Set<string>();
  const combined = [...prefix, ...substring].filter((r) => {
    const key = `${r.name.toLowerCase()}|${(r.admin ?? "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return combined.slice(0, RESULT_LIMIT);
}
