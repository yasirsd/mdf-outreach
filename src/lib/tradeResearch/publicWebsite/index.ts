/**
 * TH04B — Trade-research public-website provider barrel.
 *
 * Thailand V1 only (per TH04B scope). US / CA website evidence
 * continues to flow through the existing Buyer Finder
 * free-enrichment path; the trade-research pipeline historically
 * had no public-website provider, so this is additive and does
 * NOT duplicate US / CA plans.
 *
 * The executor reuses:
 *   - TH03 Thai text / phone / legal-name normalizers,
 *   - TH03 website hints (contact-path candidates, /en/ preference,
 *     browser-automation forbidden, robots respect required),
 *   - the signal extractors in `extractors.ts`.
 *
 * ₹0 provider — no paid API, no proxy, no search service, no
 * Hunter reveal, no LinkedIn scraping, no email guessing. Public
 * contacts are observed only when the candidate's own site displays
 * them in rendered page bytes.
 */

export const PUBLIC_WEBSITE_PROVIDER_ID = "public-website" as const;

export const PUBLIC_WEBSITE_SOURCE_URL =
  "https://example.invalid/" as const; // Placeholder — real source URL = candidate's own website.

export const PUBLIC_WEBSITE_ATTRIBUTION =
  "Source: candidate company's own public website. Supporting evidence only — never regulatory, shipment, or buyer-intent evidence." as const;

/**
 * TH04C Step 0C — parser version bumped to v2 because TH04B
 * homepage-only semantics are superseded by TH04C's bounded 3-page
 * sweep (homepage + best contact/about + best product/import).
 * US / Canada are not affected because `PUBLIC_WEBSITE_DESCRIPTOR`
 * carries `countries: ["TH"]` and no US/CA certification rows
 * exist for `public-website-html-v1`.
 */
export const PUBLIC_WEBSITE_PARSER_VERSION = "public-website-html-v2" as const;
export const PUBLIC_WEBSITE_INTERPRETATION_VERSION = "public-website-html-v2:t08-v1" as const;

export {
  extractPublicWebsiteSignals,
  normalizeThaiLegalName,
  type PublicWebsiteSignals,
  type PublicWebsiteSignalExtractionInput,
} from "./extractors";

export {
  isPathAllowedByRobots,
  robotsAllowsFetch,
  DEFAULT_PUBLIC_WEBSITE_USER_AGENT,
} from "./robots";

export {
  mergePublicWebsiteSignals,
  selectSameOriginSubpages,
  type SubpageCategory,
  type MergedPublicWebsiteSignals,
} from "./multiPage";
