/**
 * TH03 — Thailand BuyerFinder normalization barrel.
 *
 * Pure helpers consumable by TH04A/B/C. No I/O, no external deps.
 */

export {
  normalizeThaiTextForDisplay,
  normalizeThaiTextForComparison,
} from "./text";

export {
  normalizeThaiJuristicNumber,
  validateThaiJuristicNumber,
  type ThaiJuristicNumberValidation,
} from "./juristicNumber";

export {
  normalizeThaiLegalName,
  type ThaiLegalForm,
  type ThaiLegalNameNormalization,
} from "./companyName";

export {
  compareThaiCompanyIdentity,
  type ThaiCompanyIdentityInput,
  type ThaiCompanyIdentityComparison,
  type ThaiCompanyMatchLevel,
  type ThaiCompanyMatchReason,
  type ThaiCompanyMatchedField,
} from "./companyIdentity";

export {
  normalizeThaiAddress,
  type ThaiAddressNormalization,
} from "./address";

export {
  normalizeThailandPhone,
  type ThaiPhoneNormalization,
} from "./phone";

export {
  THAI_CONTACT_PATH_HINTS,
  THAI_ANCHOR_TEXT_HINTS,
  THAILAND_WEBSITE_HINTS,
  type ThailandWebsiteHintsConfig,
} from "./websiteHints";

export {
  THAILAND_KEYWORDS,
  THAILAND_KEYWORDS_VERSION,
  type ThailandKeywordDictionary,
} from "./keywords";
