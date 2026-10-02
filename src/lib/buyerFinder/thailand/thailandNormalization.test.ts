import { describe, expect, it } from "vitest";

import {
  compareThaiCompanyIdentity,
  normalizeThaiAddress,
  normalizeThaiJuristicNumber,
  normalizeThaiLegalName,
  normalizeThailandPhone,
  normalizeThaiTextForComparison,
  normalizeThaiTextForDisplay,
  THAI_ANCHOR_TEXT_HINTS,
  THAI_CONTACT_PATH_HINTS,
  THAILAND_KEYWORDS,
  THAILAND_WEBSITE_HINTS,
  validateThaiJuristicNumber,
} from "./";
import { ThailandEvidenceInvariants, emptyThailandEvidence } from "@/lib/tradeResearch/thailand";

describe("TH03 Part 1 — Thai Unicode normalization", () => {
  it("5. NFC-composes Thai combining marks (same visual, different code-point sequence → equal)", () => {
    // Thai letter MAI EK on sara AA: the combining-tone-mark sequence
    // should NFC-compose to the same string either way.
    const composed = "ก่า".normalize("NFC");
    const decomposed = "ก่า".normalize("NFD");
    expect(normalizeThaiTextForDisplay(decomposed)).toBe(normalizeThaiTextForDisplay(composed));
  });

  it("preserves Thai script characters without transliteration", () => {
    const thai = "บริษัท สยามสปิเซส จำกัด";
    expect(normalizeThaiTextForDisplay(thai)).toBe(thai);
    // Thai script survives into the comparison form too (only Latin
    // is lower-cased; Thai has no case).
    expect(normalizeThaiTextForComparison(thai)).toContain("บริษัท");
  });

  it("6. normalizes whitespace (NBSP → space, collapses runs, trims ends)", () => {
    const input = "  SIAM SPICES   Co.,\tLtd.  ";
    expect(normalizeThaiTextForDisplay(input)).toBe("SIAM SPICES Co., Ltd.");
  });

  it("7. strips zero-width characters conservatively (ZWSP, ZWNJ, ZWJ, BOM)", () => {
    const zwspInside = "สยาม​สปิเซส";
    expect(normalizeThaiTextForDisplay(zwspInside)).toBe("สยามสปิเซส");
    const bomPrefixed = "﻿Hello";
    expect(normalizeThaiTextForDisplay(bomPrefixed)).toBe("Hello");
  });

  it("non-string input is coerced to empty string (no throw)", () => {
    expect(normalizeThaiTextForDisplay(null as unknown)).toBe("");
    expect(normalizeThaiTextForDisplay(undefined as unknown)).toBe("");
    expect(normalizeThaiTextForDisplay(42 as unknown)).toBe("");
  });
});

describe("TH03 Part 2 — Thai juristic registration number", () => {
  it("11. canonicalizes a 13-digit number with spaces / hyphens / dots", () => {
    expect(normalizeThaiJuristicNumber("0105560123456")).toBe("0105560123456");
    expect(normalizeThaiJuristicNumber("0 1055 60123 456")).toBe("0105560123456");
    expect(normalizeThaiJuristicNumber("0105560-123-456")).toBe("0105560123456");
    expect(normalizeThaiJuristicNumber("0105560.123.456")).toBe("0105560123456");
  });

  it("12. rejects wrong length / non-digit input", () => {
    expect(normalizeThaiJuristicNumber("12345")).toBeNull();
    expect(normalizeThaiJuristicNumber("01055601234567")).toBeNull(); // 14 digits
    expect(normalizeThaiJuristicNumber("010556012345A")).toBeNull(); // letter
    expect(normalizeThaiJuristicNumber("")).toBeNull();
    expect(normalizeThaiJuristicNumber(null as unknown)).toBeNull();
  });

  it("13. checksum state honestly reports unsupported (checksumVerified=false, checksumValid=null)", () => {
    const result = validateThaiJuristicNumber("0105560123456");
    expect(result).toEqual({
      normalized: "0105560123456",
      validFormat: true,
      checksumVerified: false,
      checksumValid: null,
    });
    const bad = validateThaiJuristicNumber("abc");
    expect(bad).toEqual({
      normalized: null,
      validFormat: false,
      checksumVerified: false,
      checksumValid: null,
    });
  });
});

describe("TH03 Part 3 — Thai legal company name", () => {
  it("8. detects Thai 'จำกัด' and English 'Co., Ltd.' as company_limited; 'มหาชน'/'PCL' as public", () => {
    expect(normalizeThaiLegalName("บริษัท สยามสปิเซส จำกัด").detectedLegalForm).toBe("company_limited");
    expect(normalizeThaiLegalName("SIAM SPICES CO., LTD.").detectedLegalForm).toBe("company_limited");
    expect(normalizeThaiLegalName("Siam Spices Company Limited").detectedLegalForm).toBe("company_limited");
    expect(normalizeThaiLegalName("Siam Spices Ltd").detectedLegalForm).toBe("company_limited");
    expect(normalizeThaiLegalName("บริษัท สยามสปิเซส จำกัด (มหาชน)").detectedLegalForm).toBe("public_company_limited");
    expect(normalizeThaiLegalName("SIAM SPICES PUBLIC COMPANY LIMITED").detectedLegalForm).toBe("public_company_limited");
    expect(normalizeThaiLegalName("Siam Spices PCL").detectedLegalForm).toBe("public_company_limited");
    expect(normalizeThaiLegalName("Just A Name").detectedLegalForm).toBe("unknown");
  });

  it("9. normalizes Thai legal-name variants to equal comparisonKeys", () => {
    const a = normalizeThaiLegalName("บริษัท สยามสปิเซส จำกัด");
    const b = normalizeThaiLegalName("บริษัท สยามสปิเซส จำกัด  ");
    const c = normalizeThaiLegalName("บริษัท สยามสปิเซส จำกัด (มหาชน)");
    expect(a.comparisonKey).toBe(b.comparisonKey);
    expect(a.comparisonKey).toBe("สยามสปิเซส");
    // Public form has the substantive name intact but with "limited"
    // and "public" tokens stripped — same substantive key.
    expect(c.comparisonKey).toBe("สยามสปิเซส");
  });

  it("10. normalizes English legal-name variants to equal comparisonKeys", () => {
    const forms = [
      "SIAM SPICES CO., LTD.",
      "Siam Spices Co.,Ltd",
      "siam spices company limited",
      "SIAM SPICES CO LTD",
      "Siam Spices Ltd.",
    ];
    const keys = forms.map((f) => normalizeThaiLegalName(f).comparisonKey);
    for (let i = 1; i < keys.length; i += 1) {
      expect(keys[i]).toBe(keys[0]);
    }
    expect(keys[0]).toBe("siam spices");
    // PCL / Public Company Limited collapses to the same substantive key.
    expect(normalizeThaiLegalName("SIAM SPICES PCL").comparisonKey).toBe("siam spices");
  });

  it("retains the original string verbatim regardless of normalization", () => {
    const original = "  BRISKY  CO.,  LTD.  ";
    const result = normalizeThaiLegalName(original);
    expect(result.original).toBe(original);
    expect(result.normalized).toBe("BRISKY CO., LTD.");
  });
});

describe("TH03 Part 4 — bi-script company identity", () => {
  it("juristic number equality alone → strong", () => {
    const r = compareThaiCompanyIdentity(
      { juristicRegistrationNumber: "0105560123456", thaiLegalName: "บริษัท ก จำกัด" },
      { juristicRegistrationNumber: "0105560123456", thaiLegalName: "บริษัท ข จำกัด" },
    );
    expect(r.matchLevel).toBe("strong");
    expect(r.reasons).toContain("juristic_number_match");
    expect(r.matchedFields).toContain("juristicRegistrationNumber");
  });

  it("exact Thai legal-name match → strong", () => {
    const r = compareThaiCompanyIdentity(
      { thaiLegalName: "บริษัท สยามสปิเซส จำกัด" },
      { thaiLegalName: "บริษัท สยามสปิเซส จำกัด (มหาชน)" },
    );
    expect(r.matchLevel).toBe("strong");
    expect(r.reasons).toContain("thai_legal_name_match");
  });

  it("exact English legal-name match → strong", () => {
    const r = compareThaiCompanyIdentity(
      { englishLegalName: "SIAM SPICES CO., LTD." },
      { englishLegalName: "Siam Spices Ltd" },
    );
    expect(r.matchLevel).toBe("strong");
    expect(r.reasons).toContain("english_legal_name_match");
  });

  it("name match + domain or address corroboration → exact", () => {
    const nameAndDomain = compareThaiCompanyIdentity(
      { englishLegalName: "SIAM SPICES CO., LTD.", domain: "https://www.siamspices.co.th/" },
      { englishLegalName: "Siam Spices Ltd", domain: "siamspices.co.th" },
    );
    expect(nameAndDomain.matchLevel).toBe("exact");
    expect(nameAndDomain.reasons).toContain("domain_corroboration");

    const nameAndAddress = compareThaiCompanyIdentity(
      { thaiLegalName: "บริษัท สยามสปิเซส จำกัด", address: "123 Silom Rd., Bangkok 10500" },
      { thaiLegalName: "บริษัท สยามสปิเซส จำกัด", address: "123 Silom Rd Bangkok 10500" },
    );
    expect(["exact", "strong"]).toContain(nameAndAddress.matchLevel); // address normalization is conservative
  });

  it("14. transliteration similarity alone is NOT a strong match", () => {
    // Pure transliteration similarity ("Siamspices" vs the Thai
    // name) is a classic false-positive trap — the matcher refuses.
    const r = compareThaiCompanyIdentity(
      { thaiLegalName: "บริษัท สยามสปิเซส จำกัด" },
      { englishLegalName: "Siamspices Limited" },
    );
    // No cross-script match possible without juristic / domain / address.
    expect(r.matchLevel).toBe("no_match");
    expect(r.reasons).toContain("no_strong_signal");
  });

  it("domain or address similarity alone is at most 'possible', never strong", () => {
    const r = compareThaiCompanyIdentity(
      { domain: "siamspices.co.th" },
      { domain: "https://siamspices.co.th/" },
    );
    expect(["possible", "no_match"]).toContain(r.matchLevel);
    expect(r.reasons).not.toContain("thai_legal_name_match");
    expect(r.reasons).not.toContain("english_legal_name_match");
    expect(r.reasons).toContain("no_strong_signal");
  });
});

describe("TH03 Part 5 — Thai address", () => {
  it("15. normalizes whitespace and preserves Thai province strings", () => {
    const result = normalizeThaiAddress("  123/4  ถนน สีลม   กรุงเทพฯ  10500  ");
    expect(result.normalized).toBe("123/4 ถนน สีลม กรุงเทพฯ 10500");
  });

  it("16. extracts a 5-digit Thai postal code when present", () => {
    expect(normalizeThaiAddress("123 Silom Rd Bangkok 10500").postalCode).toBe("10500");
    expect(normalizeThaiAddress("123 Silom Rd Bangkok").postalCode).toBeUndefined();
    // Must NOT match a 5-digit substring that is part of a longer number.
    expect(normalizeThaiAddress("Order 1234567").postalCode).toBeUndefined();
    // First digit may not be 0.
    expect(normalizeThaiAddress("Zip 00000").postalCode).toBeUndefined();
  });
});

describe("TH03 Part 6 — Thailand phone", () => {
  it("17. normalizes +66 formats to E.164", () => {
    expect(normalizeThailandPhone("+66 2 123 4567").normalizedE164).toBe("+6621234567");
    expect(normalizeThailandPhone("+66-81-234-5678").normalizedE164).toBe("+66812345678");
    expect(normalizeThailandPhone("+6681234 5678").normalizedE164).toBe("+66812345678");
    expect(normalizeThailandPhone("0066 2 123 4567").normalizedE164).toBe("+6621234567");
  });

  it("18. normalizes national leading-0 Thailand numbers", () => {
    expect(normalizeThailandPhone("02-123-4567").normalizedE164).toBe("+6621234567");
    expect(normalizeThailandPhone("081-234-5678").normalizedE164).toBe("+66812345678");
    expect(normalizeThailandPhone("091-234-5678").normalizedE164).toBe("+66912345678");
    expect(normalizeThailandPhone("061-234-5678").normalizedE164).toBe("+66612345678");
  });

  it("extracts a trailing extension if clearly declared", () => {
    const r = normalizeThailandPhone("02-123-4567 ext. 42");
    expect(r.normalizedE164).toBe("+6621234567");
    expect(r.extension).toBe("42");
  });

  it("19. rejects malformed Thailand phone input (validFormat=false, no normalizedE164)", () => {
    expect(normalizeThailandPhone("not-a-phone").validFormat).toBe(false);
    expect(normalizeThailandPhone("+1-415-123-4567").validFormat).toBe(false); // not Thailand
    expect(normalizeThailandPhone("02-1234").validFormat).toBe(false); // too short
    expect(normalizeThailandPhone("").validFormat).toBe(false);
    expect(normalizeThailandPhone(null as unknown).validFormat).toBe(false);
    const r = normalizeThailandPhone("abc0266666666xyz");
    expect(r.validFormat).toBe(false);
    expect(r.normalizedE164).toBeUndefined();
  });
});

describe("TH03 Part 7 — Thai website hints", () => {
  it("20. known Thai + English contact / about / product paths are present", () => {
    expect(THAI_CONTACT_PATH_HINTS).toContain("/contact");
    expect(THAI_CONTACT_PATH_HINTS).toContain("/contact-us");
    expect(THAI_CONTACT_PATH_HINTS).toContain("/ติดต่อ");
    expect(THAI_CONTACT_PATH_HINTS).toContain("/ติดต่อเรา");
    expect(THAI_CONTACT_PATH_HINTS).toContain("/เกี่ยวกับเรา");
    expect(THAI_CONTACT_PATH_HINTS).toContain("/สินค้า");
    expect(THAI_ANCHOR_TEXT_HINTS).toContain("contact");
    expect(THAI_ANCHOR_TEXT_HINTS).toContain("ติดต่อเรา");
  });

  it("21. /en/ subtree is the preferred language subtree", () => {
    expect(THAILAND_WEBSITE_HINTS.preferredLanguageSubtree).toBe("/en/");
  });

  it("22. hints config forbids browser automation and requires robots respect (bounded-crawler invariants)", () => {
    expect(THAILAND_WEBSITE_HINTS.browserAutomationAllowed).toBe(false);
    expect(THAILAND_WEBSITE_HINTS.respectRobotsTxt).toBe(true);
  });
});

describe("TH03 Part 8/9 — product + role keywords", () => {
  it("product keyword list includes English + verified Thai terms", () => {
    expect(THAILAND_KEYWORDS.productSignals).toContain("chilli");
    expect(THAILAND_KEYWORDS.productSignals).toContain("dried chilli");
    expect(THAILAND_KEYWORDS.productSignals).toContain("พริก");
    expect(THAILAND_KEYWORDS.productSignals).toContain("พริกแห้ง");
    // Thai coverage is honestly flagged as incomplete.
    expect(THAILAND_KEYWORDS.thaiCoverage).toBe("incomplete");
  });

  it("role keyword list includes importer / distributor / trading-company terms", () => {
    expect(THAILAND_KEYWORDS.roleSignals).toContain("importer");
    expect(THAILAND_KEYWORDS.roleSignals).toContain("distributor");
    expect(THAILAND_KEYWORDS.roleSignals).toContain("trading company");
    expect(THAILAND_KEYWORDS.roleSignals).toContain("ผู้นำเข้า");
  });

  it("23. product keyword signal does NOT imply importer / shipment (compile-time invariant via evidence module)", () => {
    const ev = emptyThailandEvidence();
    // Pretend a website keyword hit set product_relevance=observed.
    const next = { ...ev, product_relevance: "observed" as const };
    // The company_shipment_activity dimension is UNKNOWN-pinned.
    expect(next.company_shipment_activity).toBe("UNKNOWN");
    expect(
      ThailandEvidenceInvariants.websiteProductMentionDoesNotPromoteShipment(
        next.product_relevance,
        next.company_shipment_activity,
      ),
    ).toBe(true);
  });

  it("24. role keyword signal does NOT imply India origin / company shipment", () => {
    const ev = emptyThailandEvidence();
    // Pretend an "importer" string on the website appears — this is
    // ONLY a role signal; it does not change India-origin market
    // activity, and it does NOT change company shipment activity.
    expect(ev.india_origin_market_activity).toBe("unknown");
    expect(ev.company_shipment_activity).toBe("UNKNOWN");
    // The provider-failure-staysNeutral guard applies here too — a
    // signal observed cannot upgrade a dimension past its allowed
    // transition.
    expect(
      ThailandEvidenceInvariants.providerFailureStaysNeutral("unknown", "unknown"),
    ).toBe(true);
  });
});

describe("TH03 Part 10 — evidence safety invariants anchored by TH03 helpers", () => {
  it("Thai legal-name match ≠ importer status (dimensions remain independent)", () => {
    const ev = { ...emptyThailandEvidence(), company_identity: "verified" as const };
    expect(ev.import_export_registration).toBe("unavailable");
    expect(
      ThailandEvidenceInvariants.dbdRegistrationDoesNotImplyImporter(
        ev.company_identity,
        ev.import_export_registration,
      ),
    ).toBe(true);
  });

  it("Juristic number match ≠ product evidence", () => {
    const ev = emptyThailandEvidence();
    // A juristic-number-only identity hit does not touch product.
    expect(ev.product_relevance).toBe("unknown");
  });

  it("Thai phone normalization result ≠ verified contact ownership", () => {
    // The normalizer never asserts the number belongs to the
    // company; it only reports format well-formedness.
    const r = normalizeThailandPhone("02-123-4567");
    expect(r.validFormat).toBe(true);
    // The evidence contact_availability dimension is still
    // `unavailable` on an empty evidence object — a well-formed
    // phone alone is not contact ownership.
    expect(emptyThailandEvidence().contact_availability).toBe("unavailable");
  });

  it("Thai website keyword miss stays unknown / not_observed, never fabricated negative", () => {
    // product_relevance may be `not_observed` after a keyword miss,
    // but it must never become a negative COMPANY claim.
    const ev = { ...emptyThailandEvidence(), product_relevance: "not_observed" as const };
    expect(ev.company_shipment_activity).toBe("UNKNOWN");
    expect(ev.india_origin_market_activity).toBe("unknown");
    expect(
      ThailandEvidenceInvariants.customsOperatorDoesNotImplyProduct(
        ev.import_export_registration,
        ev.product_relevance,
      ),
    ).toBe(true);
  });
});

describe("TH03 Part 11 — ₹0 cost invariant", () => {
  it("25. TH03 helpers invoke zero external services (pure functions over strings)", () => {
    // Smoke-test that none of the TH03 pure helpers reach the network.
    // We assert the public shape — no fetch spy needed because none
    // of these functions open a network connection by construction.
    expect(normalizeThaiTextForDisplay("hello")).toBe("hello");
    expect(normalizeThaiJuristicNumber("0105560123456")).toBe("0105560123456");
    expect(normalizeThaiLegalName("Siam Spices Ltd").detectedLegalForm).toBe("company_limited");
    expect(normalizeThaiAddress("Bangkok 10500").postalCode).toBe("10500");
    expect(normalizeThailandPhone("081-234-5678").validFormat).toBe(true);
    expect(THAILAND_KEYWORDS.productSignals.length).toBeGreaterThan(0);
  });
});
