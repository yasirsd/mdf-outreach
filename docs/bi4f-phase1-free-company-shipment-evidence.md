# BI4F Phase 1 — Free Company-Level Shipment Evidence Investigation

Status: research/experiment only  
Retrieval date: 2026-09-25  
Scope: three recent United States chilli Buyer Finder candidate names  
Decision: no production implementation, migration, or write activity

## Executive conclusion

The evidence supports conclusion **C: free sources are useful only for manual corroboration**.

Public pages can expose authentic, company-specific ocean bill-of-lading records. They are useful for proving that an exact consignee appeared on a disclosed manifest and, when the row is explicit, for preserving the supplier, date, commodity, HS code, quantity, weight, and ports. They do **not** provide a stable, lawful, zero-cost production feed: the official underlying path has acquisition and confidentiality limitations, ImportInfo restricts reuse and gates comprehensive access behind subscription, ImportYeti's structured API consumes paid credits, and the other evaluated commercial services are paid.

The three-company experiment found company-level shipment evidence for BCFoods, Silva International, and Reily Foods Company. It found related pepper evidence for BCFoods and Silva, but **no verified direct dried-red-chilli shipment**, **no verified India-origin dried-red-chilli shipment**, and **no Guntur-specific shipment evidence**.

## 1. Existing Buyer Intelligence architecture inspected

The following repository areas were inspected before source research:

- `supabase/migrations/0020_buyer_intelligence_foundation.sql`
- `supabase/migrations/0021_buyer_intelligence_write_pipeline.sql`
- `supabase/migrations/0010_buyer_finder_foundation.sql`
- `src/lib/buyerIntelligence/types.ts`
- `src/lib/buyerIntelligence/ingestion.ts`
- `src/lib/buyerIntelligence/metrics.ts`
- `src/lib/buyerIntelligence/assessment.ts`
- `src/lib/repositories/supabase/buyerIntelligenceRepositories.ts`
- `src/lib/repositories/supabase/buyerIntelligenceMappers.ts`
- `src/lib/repositories/supabase/buyerIntelligenceWriteRepository.ts`
- Buyer Finder candidate types, normalization, deduplication, mappers, and repository code
- Existing BI1, BI2, BI3, and Buyer Intelligence architecture documents
- Repository-wide references to shipment providers and earlier trade-data experiments

The current boundary is sound:

- Buyer Finder candidates hold workspace-scoped company identity fields such as company name, website, normalized domain, country, city, address, phone, and source.
- Candidate matching uses normalized corporate domains and conservative normalized company-name-plus-country comparisons. It does not license fuzzy shipment attribution.
- `buyer_intelligence_sources` holds provider/source identity, a stable source key, safe source reference/URL, access and cost classifications, observation/retrieval timestamps, and bounded metadata.
- `buyer_intelligence_claims` requires a source and source record reference and preserves evidence level/type/confidence plus raw and normalized values.
- `buyer_trade_observations` already models shipment/transaction records with source/ref, dates, origin/destination, supplier, raw product description, normalized category, optional MDF product, raw HS code, quantity/weight/value, ports, provenance, and normalization version.
- `buyer_trade_metrics` stores derived metrics with supporting count, observation watermark, and calculation version; it is not the source of truth.
- Only an actual company-specific shipment or transaction may be Level 1 `verified_trade_evidence`. Company websites, directories, registrations, and FDA importer-program lists are at most Level 2 business corroboration.
- Ingestion is append-only and idempotent for a stable source record. Materially conflicting reuse is rejected rather than silently overwriting evidence.
- The existing metric engine can derive latest activity, counts, India share/origin distribution, and supplier metrics from eligible Level 1 observations.
- No live company-shipment provider or permanent adapter exists. Existing code is provider-neutral and fixture-based.

## 2. Selected companies and rationale

The sample deliberately uses only three names from the recent United States chilli Buyer Finder QA set.

| Candidate name | Canonical identity used for research | Why selected |
|---|---|---|
| BCFoods | BCFoods, Inc.; `bcfoods.com`; 1330 N. Dutton Ave., Suite 100, Santa Rosa, CA 95401 | Exact corporate site identity, distinctive name/domain, exact address available in manifest-derived data |
| Silva International | Silva International, Inc.; `silva-intl.com`; 523 N. Ash St., Momence, IL 60954 | Exact legal-style name and address, distinctive domain, publicly documented ingredient portfolio |
| Reily Foods Company | Reily Foods Company; `reilyproducts.com` / evidenced `reilyfoods.com` email domain; New Orleans, LA | Long-established unambiguous company; official company page and exact name/address/domain evidence in records |

Production candidate UUIDs were not queried. No production database read was needed to test the names supplied in the QA context, and no identifier was fabricated.

Official identity references: [BCFoods contact](https://bcfoods.com/contact/), [Silva contact](https://silva-intl.com/contact), and [Reily contact](https://reilyproducts.com/contact-us/).

## 3. Source matrix

### Access and suitability

| Source | Source type / coverage | Company-level | Free path | Login / paid wall | API / machine-readable path | Classification |
|---|---|---:|---|---|---|---|
| CBP vessel manifest disclosure under 19 CFR 103.31 | Official U.S. ocean-manifest disclosure; names may be suppressed | Yes, when disclosed | Public request mechanism, but acquisition can involve fees/operational delay | No ordinary search UI; confidentiality requests remove identities | No verified modern free production API | **BLOCKED / LEGALLY OR TECHNICALLY UNSUITABLE** for a ₹0 automated product; authoritative acquisition source only |
| ImportInfo | CBP-derived U.S. ocean BOL search, stated coverage since 2012 and daily updates | Yes | Public company pages and limited rows | Comprehensive access/download depends on subscription | HTML is readable, but no documented free API; terms restrict exploitation/non-personal reuse | **PROMISING FOR MANUAL RESEARCH ONLY** |
| ImportYeti public website | U.S. sea-freight BOL company search | Yes | Free signup/UI | Structured API requires account/key and data credits | Documented API exists but normal data calls consume credits | **PROMISING FOR MANUAL RESEARCH ONLY** |
| FDA FSVP/VQIP public material | Official food-importer program identity corroboration | Company identity only | Yes | No paid wall | Public pages/PDFs; not a shipment API | **USEFUL AS SECONDARY CORROBORATION** |
| Panjiva | Commercial global shipment search with limited public previews | Yes | Limited preview only | Advanced/comprehensive access requires subscription | No suitable free production API verified | **PAID / NOT SUITABLE** |
| ImportGenius | Commercial BOL-level U.S./global trade data | Yes | No durable free production tier found | Plans start at USD 229/month | Paid product/downloads | **PAID / NOT SUITABLE** |
| Volza | Commercial trade intelligence | Yes | Trial/limited credits are not durable ₹0 access | Paid plans and metered API | API is priced per search/record | **PAID / NOT SUITABLE** |
| Trademo Intel | Commercial trade prospecting | Yes | No durable production-grade free tier verified | Custom/credit-based plans | Commercial access | **PAID / NOT SUITABLE** |
| USITC DataWeb | Official aggregate tariff-category statistics | No | Free account | No relevant paid wall | Aggregate data only | **MARKET-LEVEL ONLY** |
| UN Comtrade / BACI | Country/product aggregate trade datasets already used in Market Intelligence | No | Public/research access varies | Not relevant | Aggregate data only | **MARKET-LEVEL ONLY** |
| Search-engine snippets | Discovery index, not an underlying record | Not durable | Yes | N/A | N/A | **BLOCKED / LEGALLY OR TECHNICALLY UNSUITABLE** as evidence |

### Fields visible in the most useful public source

ImportInfo's opened public records exposed consignee, shipper, arrival date, ports, quantity, weight, commodity description, and sometimes HS code. Its [FAQ](https://www.importinfo.com/faq) says the data comes from CBP public-information requests, covers U.S. ocean-freight bills of lading, and gates downloads by subscription level. Its [terms](https://www.importinfo.com/terms-of-use) restrict protected content to personal use absent permission. That combination makes it suitable for this bounded manual investigation, not as an MDF production dependency.

ImportYeti documents a useful structured company/BOL API, but the [getting-started guide](https://docs.importyeti.com/docs/getting-started) requires an API key and says company-profile calls consume data credits. Its [coverage explanation](https://www.importyeti.com/our-data) also confirms the ocean-only boundary, possible confidentiality suppression, alternate company names, and absence of air/land records.

The official boundary is consistent with those limitations: [USITC states](https://www.usitc.gov/faq/question/where_can_i_find_trade_statistics_and_names_other.htm) that DataWeb is tariff-category data and that individual-company trade activity is not published as ordinary government trade statistics. [CBP explains](https://www.help.cbp.gov/s/article/Article-1108) that manifest information may be requested while importer/consignee/shipper identities may receive confidential treatment.

Commercial benchmark references: [Panjiva shipment search](https://panjiva.com/shipment_search), [ImportGenius pricing](https://w3.importgenius.com/pricing), [Volza pricing](https://www.volza.com/pricing/), [Volza API](https://www.volza.com/trade-intelligence-apis/), and [Trademo pricing](https://www.trademo.com/intel/pricing).

## 4. Sources actually tested

Public pages were opened and inspected for:

- ImportInfo company, supplier, recent-row, sample-manifest, FAQ, and terms pages
- ImportYeti API documentation, data coverage explanation, and data-use policy; no account was created and no API call was made
- Panjiva company previews and shipment-search access boundary
- ImportGenius, Volza, and Trademo official pricing/access pages
- USITC official company-data FAQ and DataWeb boundary
- CBP manifest-confidentiality guidance and the governing 19 CFR material
- FDA FSVP/VQIP official public material
- Official company identity/contact/product pages for the selected companies

Search results were used only to locate underlying pages. No search snippet was accepted as shipment evidence. No login wall, paywall, CAPTCHA, robots/access control, or hidden endpoint was bypassed.

## 5. Company-by-company experiment results

### Summary

| Company | Company shipment evidence | Target-product evidence | India-origin evidence | Guntur evidence | Public aggregate visible at retrieval | Match confidence |
|---|---:|---|---|---:|---|---|
| BCFoods | Yes | No Level A; Level B green jalapeno/pepper rows | No accepted India-origin target record | No | ImportInfo displayed roughly 6,600 BOLs, 619 in the past year | Exact/strong |
| Silva International | Yes | No Level A; Level B dehydrated red bell pepper under HS 090421 | Yes for unrelated cilantro/parsley; no target-product India evidence | No | ImportInfo displayed 6,587 BOLs, 918 in the past year | Exact |
| Reily Foods Company | Yes | No; opened rows were chicory | No target-product India evidence | No | ImportInfo displayed 346 BOLs, 13 in the past year | Exact/strong |

Visible aggregate counts are source-reported ocean-manifest index counts, not MDF-derived complete trade histories.

### BCFoods

- **Canonical identity:** BCFoods, Inc., `bcfoods.com`, 1330 N. Dutton Ave., Suite 100, Santa Rosa, CA 95401. The address matches the [public ImportInfo company page](https://www.importinfo.com/bcfoods-inc). A sample BOL also showed the exact consignee at its Bolingbrook facility and a `@bcfoods.com` contact.
- **Accepted company evidence:** exact company name plus exact corporate address or exact company email domain. ImportInfo exposed individual consignee rows with dates, ports, quantities, weights, commodity, and suppliers.
- **Relevant product result:** two public recent rows showed `AD GREEN JALAPENO PEPPER DICE` and `AD GREEN JALAPENO POWDER` arriving 2026-09-19 from Qingdao/China. These are **Level B related-product signals**, not evidence of dried red chilli and not evidence of the Guntur product.
- **Opened sample:** 2026-09-13 actual arrival, 865 cartons / 18,058 kg of peas from Heinz Watties in New Zealand to BCFoods, Bolingbrook, HS 071310. This proves the company-specific record shape, not chilli evidence.
- **India result:** an aggregate associated-company label named BCFoods (India) Seasonings, but no qualifying underlying India-origin chilli record was opened. The aggregate association was therefore rejected as a company-product shipment claim.
- **Latest observed public row in the page examined:** arrival 2026-09-20 for dehydrated sweet potato. This is not a target-product result.
- **Coverage limits:** ocean manifests only; confidential names can be absent; public page rows and aggregate counts can change; complete downloads are subscription-gated; public results do not establish total imports by all modes.

### Silva International

- **Canonical identity:** Silva International, Inc., `silva-intl.com`, 523 N. Ash St., Momence, IL 60954. The official [contact page](https://silva-intl.com/contact) and [ImportInfo company page](https://www.importinfo.com/silva-international-inc) match exactly.
- **Accepted company evidence:** exact legal name and exact street/city/state/ZIP on the company index and consignee records.
- **Related pepper record 1:** [Yancheng Weiguan Foods](https://www.importinfo.com/yancheng-weiguan-foods-co-ltd) to Silva International; actual arrival 2026-05-05 at Long Beach; 1,100 cartons / 18,700 kg; China; commodity `ORGANIC DEHYDRATED RED BELL PEPPER`; HTSUS 090421.
- **Classification:** **Level B**, not Level A. The HS code is relevant to dried Capsicum/Pimenta, but the explicit commodity says red bell pepper. The description cannot be overwritten by a target-biased HS interpretation.
- **Related pepper record 2:** a public 2026-08-10 Silva row from Xinghua Jiahe described dehydrated red bell pepper. This independently supports related pepper activity, still not dried red chilli.
- **India-origin records:** [Flex Foods](https://www.importinfo.com/flex-foods-limited) to the exact Silva consignee showed India-origin dehydrated parsley (arrival 2026-08-24; 756 cases / 8,845 kg) and cilantro (arrival 2026-08-15; 756 cases / 8,146 kg). These prove India-origin company shipments for unrelated products only.
- **Latest observed company-page summary:** 2026-09-18. It is not asserted to be a target-product shipment.
- **Coverage limits:** same ocean/confidentiality/public-preview limits; an official Silva product matrix can corroborate that the business handles peppers, but it is Level 2 business evidence and cannot turn a non-target BOL into a dried-red-chilli shipment.

### Reily Foods Company

- **Canonical identity:** Reily Foods Company, New Orleans. The official [Reily contact page](https://reilyproducts.com/contact-us/) identifies the company and its New Orleans office. The [ImportInfo company page](https://www.importinfo.com/reily-foods-co) used the exact company name and New Orleans address; the sample BOL had an exact `@reilyfoods.com` email.
- **Accepted company evidence:** exact company name, exact New Orleans address, and exact corporate email domain in the consignee record.
- **Opened record:** actual arrival 2026-08-12 at New Orleans; Leroux, France to Reily Foods Company; 800 bags / 20,514 kg; roasted and ground chicory. Other visible 2026 rows were also chicory.
- **Product result:** no chilli or target-product shipment found in the public records tested.
- **India/Guntur result:** no qualifying evidence found.
- **Latest observed company-page summary:** 2026-09-04; visible total 346 and 13 in the past year.
- **Secondary corroboration:** FDA's FSVP public material can corroborate that named firms participate in food-import compliance. It is not a BOL feed and cannot support a shipment/product claim. The [FSVP overview](https://www.fda.gov/food/food-safety-modernization-act-fsma/final-rule-foreign-supplier-verification-programs-fsvp-glance) explains the importer/foreign-supplier verification role.
- **Coverage limits:** ocean-only public manifests, possible confidentiality, partial public page, and no basis to convert Reily's spice/food business profile into chilli-import evidence.

## 6. Entity-match methodology

The experiment used a deterministic evidence ladder:

1. **Exact:** source entity name plus exact official address, or exact official domain/email domain tied to the manifest party.
2. **Strong:** exact normalized name plus matching city/state and an independently verified address/domain relationship.
3. **Ambiguous:** name-only match, unexplained DBA/subsidiary, conflicting geography, or an aggregate association without an underlying record.
4. **Rejected:** only a similar name, only a product/category overlap, or an entity relationship inferred from search results.

Normalization may remove casing, punctuation, `www`, and legal suffixes for comparison. It may not merge different legal entities, infer a parent/subsidiary, or replace address/domain evidence. Only exact or strong matches were accepted. Ambiguous and rejected matches create no company claim.

## 7. Product-match methodology

The existing BI evidence levels remain authoritative; this research adds a target-specific classifier proposal rather than replacing them:

- **Level A — direct target-product match:** the same accepted shipment row explicitly describes dried red chilli/chili/chile peppers or an equally specific target description. HS 090421 may strengthen the match, but it cannot override a conflicting explicit description.
- **Level B — related product:** jalapeno, bell pepper, paprika, ambiguous Capsicum/pepper, or a broader chilli/pepper preparation that does not establish dried red chilli.
- **Level C — generic:** spices, seasonings, food products, groceries, vegetables, or agricultural products.

Only Level A can support “this company imported dried chilli.” Level B is a weaker related-product signal. Level C is not target-product evidence. No sampled record reached Level A.

## 8. India-origin evidence methodology

India origin is accepted only when the qualifying underlying company-specific shipment identifies India through an explicit origin/shipper country or an unambiguous Indian foreign port tied to that record. Supplier name, company association, website text, or an aggregate country chart alone is insufficient for a target-product claim.

India and product specificity are evaluated independently. Silva's India-origin cilantro/parsley records establish an India trading relationship, but not India-origin chilli.

## 9. Guntur-specific evidence rule

“Guntur” may be asserted only when the same shipment record explicitly identifies Guntur, or a separately sourced company-specific document durably and unambiguously links that shipment/product to Guntur. HS 090421 + dried chilli + India still supports only “imported dried chilli from India.” None of the sampled evidence supports Guntur.

## 10. Shipment metrics feasibility

The public pages demonstrate that individual records can carry enough fields to derive counts, first/latest date, recent activity, suppliers, origins, product-description distributions, weight totals, and ports. Those metrics are safe only within a declared coverage envelope.

Current public previews do not establish a complete envelope because they are ocean-only, identities may be confidential, public rows are partial, and full downloads are paid. Accordingly:

- individual-record facts may be manually corroborated;
- source-displayed aggregate counts may be reported as source aggregates with retrieval date;
- MDF must not call them total company import counts across all modes;
- MDF must not recompute complete-history metrics from a partial preview;
- cross-source counts must not be summed until record-level deduplication is proven.

## 11. Provenance model

Every future normalized fact should retain:

- candidate ID and accepted canonical identity;
- source/provider and source type;
- stable source record reference (BOL/manifest number when available);
- safe public URL and retrieval timestamp;
- matched source entity name/address/domain and match decision;
- importer/consignee role;
- raw product description and raw HS code;
- normalized product/category plus classifier version and specificity decision;
- shipment/arrival date, origin, destination, ports, supplier, quantity, unit, weight, and currency exactly when present;
- access class, cost class, coverage statement, and source-terms snapshot/version;
- review status and reviewer/time for manual evidence.

Do not preserve an inaccessible snippet as authoritative evidence. If the underlying record becomes unavailable, retain the source reference and prior observed fact with a clear availability/withdrawal state; do not present it as freshly reverified.

## 12. Source-quality assessment

| Source | Authority | Company specificity | Product/quantity detail | Freshness | Reproducibility | Access/terms suitability |
|---|---|---|---|---|---|---|
| CBP disclosure | Highest underlying authority | Good when not confidential | Manifest-level | Request-dependent | Potentially durable but operationally difficult | Poor for a zero-cost automated product |
| ImportInfo public pages | Secondary compiler of CBP records | High on exact name/address/domain rows | Often strong on public sample rows | Stated daily; live pages observed | Medium for manual checks; public results can change | Poor for production automation under published terms/subscription model |
| ImportYeti UI | Secondary compiler of CBP records | High when address/entity resolved | Strong in product design | Current database claimed | Medium manually | UI promising manually; API not ₹0 |
| FDA FSVP/VQIP | Official | Good for named importer/program participation | No shipment facts | Periodic | High for published lists | Good as secondary corroboration only |
| Panjiva | Commercial compiler | Often strong | Preview-dependent | Commercial | Low without subscription | Not suitable at ₹0 |
| ImportGenius / Volza / Trademo | Commercial compilers | Potentially strong | Potentially strong | Commercial | Paid | Not suitable at ₹0 |
| USITC / Comtrade / BACI | Official/research aggregate | None | Country/product aggregate only | Good for market analysis | High | Correct for Market Intelligence, invalid for company shipment claims |

No synthetic universal numeric score was created because authority, specificity, completeness, rights, and reproducibility are distinct dimensions.

## 13. Zero-cost feasibility conclusion

**Conclusion C — free sources are useful only for manual corroboration.**

Why not A: no tested source provides a stable, comprehensive, legitimate, free production API/feed.

Why not B: the only structured API tested is credit-metered, the richest free pages restrict reuse or comprehensive access, and official raw acquisition is not a verified no-cost operational feed. Calling a manually viewed HTML preview “partial automation” would obscure the rights and completeness risk.

Why not D: authentic company-specific public records are genuinely available and useful for bounded human verification, so ₹0 evidence is not impossible; it is unsuitable as a reliable automated pipeline.

## 14. Recommended BI4F Phase 2 architecture — proposal only

Do **not** start an automated provider adapter under the present ₹0 constraint. If a manual-corroboration Phase 2 is separately approved, use this bounded design:

1. An owner-only research intake, not a browser scraper, accepts a candidate plus a human-supplied public record URL/reference.
2. Identity resolution compares official candidate name/domain/address against the source entity and records exact/strong/ambiguous/rejected with reasons.
3. A reviewer transcribes only visible shipment fields and raw text; missing values remain null.
4. A versioned classifier assigns target product specificity A/B/C without changing the raw description.
5. Ingestion maps accepted evidence to the existing source and trade-observation contracts only after a second review.
6. Within-source idempotency uses provider + stable source reference. A cross-source fingerprint flags probable duplicate manifests for review rather than auto-merging.
7. Level 1 is reserved for an accessible underlying shipment/transaction record; company/site/FDA evidence remains Level 2.
8. Metrics run only over Level 1 observations and carry a coverage envelope/watermark. Partial-public-page data does not produce complete-history metrics.
9. Refresh is manual and low-frequency until an approved zero-cost source grants durable automation rights.
10. Provider-specific rate limits default to zero automated requests. No paid key or browser automation may be enabled.
11. A hard cost guard rejects providers whose configured cost class is not `free` and approved.
12. Every source must pass legal/terms, reproducibility, coverage, and identity tests before an automated adapter can be proposed again.

This is an architecture proposal only. No route, adapter, worker, script, or database function was created.

## 15. Existing schema fit

The current normalized schema can already represent most of a manually verified shipment:

- source/provider/reference/access/cost/retrieval data → `buyer_intelligence_sources`;
- company-specific shipment, dates, parties, origin/destination, product/HS, quantity/weight/value, ports, raw provenance → `buyer_trade_observations`;
- derived activity/origin/supplier/count metrics with watermark/version → `buyer_trade_metrics`;
- non-shipment official/company corroboration → `buyer_intelligence_claims`;
- confidence/recommendation with explicit evidence links → assessment tables.

The existing append-only RPC boundary and conflict behavior are compatible with durable evidence. Existing BI taxonomy already prevents website research from masquerading as Level 1 trade evidence.

## 16. Schema gaps, if any

These are future design gaps, not a request for a migration:

1. Identity-match evidence is not first-class: matched source name/address/domain, match method, decision, reason, reviewer, and review timestamp currently fit only as metadata.
2. Access rights need more detail than `access_class`/`cost_class`: terms URL/version, allowed automation/reuse, coverage license, and last rights review.
3. Cross-provider deduplication is not first-class: the same manifest from two compilers needs a canonical fingerprint and multiple provenance links.
4. Source correction/withdrawal/disappearance lifecycle is not explicit.
5. Coverage envelope is not first-class: mode, date window, preview/sample/comprehensive status, confidentiality caveat, and refresh cursor.
6. Target-product specificity A/B/C and classifier version are not dedicated fields; existing raw/normalized product fields can carry the data temporarily but not the full decision audit.

Any Phase 2 proposal should first validate whether bounded metadata and existing evidence-link tables are sufficient. Only then should an additive migration be designed.

## 17. Migration required now

**NO.** No migration was created or edited.

## 18. Production writes

**ZERO.** No Supabase RPC, table write, candidate mutation, Buyer conversion, or enrichment write was performed.

## 19. Provider/paid API calls

**ZERO.** Public web pages and documentation were read. No ImportYeti API key/account/credit, paid API, subscription, or provider endpoint was invoked.

## 20. Experimental files added

- `docs/bi4f-phase1-free-company-shipment-evidence.md` — this research report only.

No experimental script was added because no suitable legitimate, machine-readable, zero-cost API was found.

## 21. Limitations

- The experiment covers three companies and public U.S. ocean-manifest-derived pages, not all recent candidates or all transport modes.
- Vessel-manifest identities can be confidential; absence is not proof that a company never imported.
- Public compiler counts are mutable and may reflect company/entity grouping choices.
- Public preview rows are not a complete history and cannot support exhaustive frequency/share metrics.
- Product text can be truncated, inconsistent, or broader/narrower than the HS code; raw description remains authoritative for classification.
- Foreign port is not always equivalent to product origin; accepted origin claims require explicit/unambiguous record evidence.
- The investigation did not test authenticated free UI functionality, because production suitability requires a durable access right, not a one-off account session.
- This is technical/product feasibility research, not legal advice. Production reuse terms would require owner/legal approval.

## 22. GO / NO-GO recommendation for BI4F Phase 2

**NO-GO for an automated company-shipment pipeline under the ₹0 requirement.**

**Conditional GO only for a separately scoped, owner-reviewed manual corroboration workflow** using public accessible records and the existing evidence boundary.

Exact gates before automated Phase 2 can become GO:

- at least one legitimate source provides reproducible company-level shipment records through a documented zero-cost machine-readable path;
- terms explicitly permit MDF's intended automated retrieval, storage, and derived use;
- company identity can be matched with exact/strong evidence and ambiguous rows are quarantined;
- stable record identifiers and durable provenance are available;
- product descriptions are sufficiently specific to support target classification without HS-only overreach;
- coverage and confidentiality limitations can be represented and surfaced;
- refresh limits and a hard ₹0 cost guard are enforceable;
- a fixture-backed test proves normalization, idempotency, deduplication, and no evidence inflation before any live write.

Until all gates pass, do not build a scraper, provider worker, production route, or automatic refresh.

## 23. READY FOR BI4F REVIEW

**YES.** The research question is answered, the negative automation result is evidence-based, and the permitted manual-corroboration path is clearly bounded.

## Validation and safety record

- Code changed: NO
- Full build: not run; not required for a documentation-only research artifact
- Tests: not run; no executable code was added
- Production writes: ZERO
- Paid/provider API calls: ZERO
- Migration changes: ZERO
- Buyer Finder changes: ZERO
- Outreach automation: NOT STARTED
