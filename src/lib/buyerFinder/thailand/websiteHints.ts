/**
 * TH03 — Thailand-safe website navigation hints.
 *
 * CONFIGURATION ONLY. This module does NOT fetch, crawl, or alter
 * the existing crawler lifecycle. It exposes:
 *
 *   - a bounded list of path candidates likely to carry contact /
 *     about / product information on Thai websites,
 *   - a bounded list of anchor-text candidates (English + Thai)
 *     the crawler can match against link labels,
 *   - a hint that the `/en/` subtree is preferable when both Thai
 *     and English versions of a site exist.
 *
 * The existing crawler must stay bounded, robots-respecting, and
 * free of browser automation. These are hints only; the crawler
 * decides whether to follow a link.
 */

export const THAI_CONTACT_PATH_HINTS: readonly string[] = [
  "/contact",
  "/contact-us",
  "/contact.html",
  "/about",
  "/about-us",
  "/products",
  "/product",
  "/import",
  "/distribution",
  // Thai-script contact paths. Some Thai sites expose these at
  // non-URL-encoded paths; the crawler's URL constructor will
  // encode them before issuing the request.
  "/ติดต่อ",
  "/ติดต่อเรา",
  "/เกี่ยวกับเรา",
  "/สินค้า",
  "/ผลิตภัณฑ์",
] as const;

export const THAI_ANCHOR_TEXT_HINTS: readonly string[] = [
  // English
  "contact",
  "contact us",
  "about",
  "about us",
  "products",
  "product",
  "importer",
  "distributor",
  // Thai
  "ติดต่อ",
  "ติดต่อเรา",
  "เกี่ยวกับเรา",
  "สินค้า",
  "ผลิตภัณฑ์",
] as const;

export interface ThailandWebsiteHintsConfig {
  readonly preferredLanguageSubtree: "/en/";
  readonly pathHints: readonly string[];
  readonly anchorTextHints: readonly string[];
  readonly browserAutomationAllowed: false;
  readonly respectRobotsTxt: true;
}

/** Immutable config object for the crawler to consume. */
export const THAILAND_WEBSITE_HINTS: ThailandWebsiteHintsConfig = {
  preferredLanguageSubtree: "/en/",
  pathHints: THAI_CONTACT_PATH_HINTS,
  anchorTextHints: THAI_ANCHOR_TEXT_HINTS,
  browserAutomationAllowed: false,
  respectRobotsTxt: true,
};
