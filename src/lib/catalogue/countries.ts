import { iso31661 } from "iso-3166";

/**
 * MDF Outreach — canonical country list.
 *
 * SOURCE OF TRUTH: the `iso-3166` npm package (MIT license). It ships
 * every currently-assigned ISO-3166-1 alpha-2 country / territory —
 * 249 rows at the time of writing. We do NOT hand-maintain a subjective
 * subset; the list is derived from the standard.
 *
 * DISPLAY NAMES: the ISO catalogue uses formal names such as
 * "United Kingdom of Great Britain and Northern Ireland" or
 * "Korea, Republic of". Operators reasonably expect "United Kingdom"
 * and "South Korea", so `DISPLAY_OVERRIDES` swaps a small set to the
 * informal name and preserves the ISO name as a search alias. The
 * override table only touches display strings — every ISO alpha-2 row
 * remains present.
 *
 * ALIASES: informal names, common abbreviations, alternate spellings
 * that operators actually type (UAE / USA / UK / KSA / Burma / DRC /
 * Ivory Coast / …). Search matches on display name + aliases +
 * ISO-2/3 codes.
 *
 * PERSISTENCE: display name string. Existing buyer/campaign rows
 * created while country was free text continue to match without a
 * migration. Values that do NOT match a canonical row surface as
 * "Legacy" and are preserved on unrelated saves.
 */

export interface Country {
  code: string;
  name: string;
  aliases?: string[];
}

// Informal display swap for names ISO writes in a formal register.
// Right-hand side is the display shown to operators.
const DISPLAY_OVERRIDES: Record<string, string> = {
  BO: "Bolivia",
  BN: "Brunei",
  CV: "Cape Verde",
  CD: "Democratic Republic of the Congo",
  CG: "Republic of the Congo",
  CZ: "Czech Republic",
  FK: "Falkland Islands",
  FM: "Federated States of Micronesia",
  GB: "United Kingdom",
  IR: "Iran",
  KP: "North Korea",
  KR: "South Korea",
  LA: "Laos",
  MD: "Moldova",
  MK: "North Macedonia",
  PS: "Palestine",
  RU: "Russia",
  SY: "Syria",
  TW: "Taiwan",
  TZ: "Tanzania",
  US: "United States",
  VE: "Venezuela",
  VN: "Vietnam",
  // Small territories that get formal names from ISO:
  VG: "British Virgin Islands",
  VI: "U.S. Virgin Islands",
  SH: "Saint Helena",
  PM: "Saint Pierre and Miquelon",
  BQ: "Bonaire, Sint Eustatius and Saba",
};

// Extra informal aliases operators type. Keys are alpha-2.
const EXTRA_ALIASES: Record<string, string[]> = {
  AE: ["UAE", "Emirates"],
  US: ["USA", "US", "America"],
  GB: ["UK", "Britain", "England"],
  SA: ["KSA"],
  KR: ["Korea"],
  KP: ["DPRK"],
  CD: ["DRC", "Congo Kinshasa"],
  CI: ["Ivory Coast"],
  CZ: ["Czechia"],
  DE: ["Deutschland"],
  IN: ["Bharat"],
  JP: ["Nippon"],
  RU: ["Russian Federation"],
  ES: ["España"],
  TH: ["Siam"],
  TL: ["East Timor"],
  TR: ["Turkey"],
  MK: ["Macedonia"],
  MM: ["Burma"],
  NL: ["Holland"],
  SZ: ["Swaziland"],
  MO: ["Macau"],
  VN: ["Viet Nam"],
  BN: ["Brunei Darussalam"],
  IR: ["Persia"],
  CN: ["PRC"],
  LA: ["Lao PDR"],
  SY: ["Syrian Arab Republic"],
  TW: ["Republic of China", "ROC"],
  AU: ["Aussie"],
  HK: ["HK SAR"],
};

function buildCountries(): Country[] {
  const rows: Country[] = [];
  for (const iso of iso31661) {
    if (iso.state !== "assigned") continue;
    const code = iso.alpha2;
    const displayName = DISPLAY_OVERRIDES[code] ?? iso.name;
    const aliases: string[] = [];
    // Preserve the ISO official name as a searchable alias when it
    // differs from the display name.
    if (displayName !== iso.name) aliases.push(iso.name);
    for (const extra of EXTRA_ALIASES[code] ?? []) {
      if (aliases.includes(extra)) continue;
      if (displayName.toLowerCase() === extra.toLowerCase()) continue;
      aliases.push(extra);
    }
    // Alpha-3 code (`USA`, `GBR`, `IND`) is a useful search hint.
    if (!aliases.includes(iso.alpha3)) aliases.push(iso.alpha3);
    rows.push({ code, name: displayName, aliases });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export const COUNTRIES: readonly Country[] = buildCountries();

/** Look up a country by canonical DISPLAY name (case-insensitive). */
export function findCountryByName(name: string | undefined | null): Country | undefined {
  if (!name) return undefined;
  const norm = name.trim().toLowerCase();
  return COUNTRIES.find((c) => c.name.toLowerCase() === norm);
}

/** Look up a country by ISO-3166 alpha-2 code (case-insensitive). */
export function findCountryByCode(code: string | undefined | null): Country | undefined {
  if (!code) return undefined;
  const norm = code.trim().toUpperCase();
  return COUNTRIES.find((c) => c.code === norm);
}

/**
 * Return the ISO-3166 alpha-2 code for a canonical name. Also matches
 * ISO official names (via aliases) so legacy rows persisted with an
 * ISO formal name still map correctly.
 */
export function codeForCountryName(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  const direct = findCountryByName(name);
  if (direct) return direct.code;
  const norm = name.trim().toLowerCase();
  return COUNTRIES.find((c) =>
    c.aliases?.some((a) => a.toLowerCase() === norm),
  )?.code;
}

/** Full-text country search by name + aliases + code prefix. */
export function searchCountries(query: string): Country[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...COUNTRIES];
  return COUNTRIES.filter((c) => {
    if (c.name.toLowerCase().includes(q)) return true;
    if (c.code.toLowerCase().startsWith(q)) return true;
    if (c.aliases?.some((a) => a.toLowerCase().includes(q))) return true;
    return false;
  });
}
