/**
 * TH03 — Thailand product + role keyword foundations.
 *
 * Keyword SIGNALS, not conclusions. The downstream aggregator in
 * TH04B / TH05 inspects website text for these tokens and only
 * records "signal observed" / "signal not observed". A product
 * keyword hit NEVER promotes to a shipment, origin, or importer
 * conclusion by itself.
 *
 * The Thai lists are intentionally conservative. Only well-known,
 * unambiguous Thai terms are included; the brief forbids guessed
 * translations. Both lists are explicitly marked as incomplete so
 * TH04B / future audits can add verified terms as they are found.
 *
 * Guntur Dry Red Chilli is the Thailand V1 primary product.
 */

export const THAILAND_KEYWORDS_VERSION = "thailand-keywords-v1" as const;

export interface ThailandKeywordDictionary {
  /** Primary business product keywords (chilli / spice family). */
  readonly productSignals: readonly string[];
  /** Role / business-type keywords for buyer-finder evidence. */
  readonly roleSignals: readonly string[];
  /** Contact-page / contact-element keywords. */
  readonly contactSignals: readonly string[];
  /**
   * Explicitly incomplete — TH04B and later audits add verified
   * Thai terms as they are found in actual Thai importer websites.
   */
  readonly thaiCoverage: "incomplete";
}

/** Guntur-dry-red-chilli English keyword set (reused by generic matcher). */
const CHILLI_EN: readonly string[] = [
  "chilli",
  "chili",
  "chile",
  "dry chilli",
  "dried chilli",
  "red chilli",
  "red chili",
  "capsicum",
  "guntur",
  "spice",
  "spices",
];

/** Guntur-dry-red-chilli Thai keyword set. Keep CONSERVATIVE. */
const CHILLI_TH: readonly string[] = [
  "พริก",       // chilli / pepper (generic Thai noun)
  "พริกแห้ง",   // dried chilli
  "พริกแดง",   // red chilli
  "เครื่องเทศ", // spice / spices
];

const ROLE_EN: readonly string[] = [
  "importer",
  "import",
  "distributor",
  "distribution",
  "wholesaler",
  "supplier",
  "food importer",
  "food distributor",
  "spice importer",
  "trading company",
];

const ROLE_TH: readonly string[] = [
  "ผู้นำเข้า",       // importer
  "ผู้จัดจำหน่าย",   // distributor
  "ผู้ค้าส่ง",        // wholesaler
  "บริษัทการค้า",   // trading company
];

const CONTACT_EN: readonly string[] = [
  "contact",
  "contact us",
  "email",
  "phone",
  "tel",
  "address",
];

const CONTACT_TH: readonly string[] = [
  "ติดต่อ",
  "ติดต่อเรา",
  "อีเมล",         // email
  "โทรศัพท์",      // phone
  "ที่อยู่",         // address
];

export const THAILAND_KEYWORDS: ThailandKeywordDictionary = {
  productSignals: [...CHILLI_EN, ...CHILLI_TH],
  roleSignals: [...ROLE_EN, ...ROLE_TH],
  contactSignals: [...CONTACT_EN, ...CONTACT_TH],
  thaiCoverage: "incomplete",
};
