# BI4F Phase 1.5 — Multi-Source Zero-Cost Trade Intelligence Automation Study

Status: investigation and architecture only  
Research date: 2026-09-25  
Automatic monetary spend: **₹0 hard limit**  
Decision: **GO for narrow automatic free screening; NO-GO for broad automatic detailed shipment evidence**

Hard runtime contract for every future planner and adapter: `AUTOMATIC_SPEND_RUPEES = 0`. Provider cost classes are `free`, `free_quota`, `manual_free`, `paid`, and `unsupported`; only the first two can ever be auto-eligible, and `free_quota` requires a confirmed available allowance.

## Executive conclusion

A useful zero-cost automation path exists, but it is narrower than a general shipment-history service.

- The FDA FSVP participant workbook can automatically corroborate that a U.S. food company was identified at entry as an FSVP importer. It does not identify the imported product, shipment, supplier, origin, or CBP importer of record.
- The FDA Import Refusal Report is a legitimate monthly machine-readable source for foreign manufacturer/product/refusal-risk evidence. It does not contain the U.S. importer/consignee and a refusal is rejected—not successful—trade.
- Canada's official Canadian Importers Database (CID) can automatically identify major importers by HS product and country of origin. It is a strong future-market screening source, but it is annual, covers businesses collectively accounting for up to about 80% of import value, may include brokers/non-resident importers, and has no company-level quantities, values, suppliers, or shipment dates.
- ImportYeti's API is structured and rich, but its company search is not a dependable unlimited-free screening layer: standalone search results can be billed at 0.1 credits per result, data endpoints consume credits, the starting/recurring free API credit allowance is not documented, and the current pricing page places API access under Enterprise. The human-search plan is explicitly for human use.
- The tested commercial BOL products remain paid, preview-only, trial-bound, or contract-priced. None is eligible for automatic execution under the ₹0 contract.

The smallest sound product is therefore:

1. automatic, cached official-dataset screening where a country/product path is genuinely available;
2. conservative entity and product classification;
3. no automatic paid or unknown-cost fallback;
4. human review for ambiguous matches and most U.S. company-level product/shipment detail;
5. Buyer Intelligence ingestion only in a later controlled phase.

No provider should be presented as evidence of more than it actually proves.

## 1. Repository architecture inspected

The following implementation areas were inspected:

- Buyer Finder run model and staleness: `src/lib/buyerFinder/searchRun.ts`
- Coalesced run progress: `src/lib/buyerFinder/searchRunProgress.ts`
- Sequential polling: `src/lib/buyerFinder/useSearchRunPolling.ts`
- Search-run execution route: `src/app/api/buyer-finder/search-runs/[id]/execute/route.ts`
- Search-run repository/mappers and migration `0013_buyer_finder_search_runs.sql`
- Free-enrichment job model, repository, worker/drain routes, autopump, and migration `0017_buyer_finder_free_enrichment_queue.sql`
- Buyer Finder provider descriptors and neutral outcomes
- Market Intelligence provider descriptors, free-only execution guard, and deterministic provider selection
- Buyer Intelligence migrations `0020` and `0021`, types, ingestion, repositories, metrics, assessment, and provenance contracts
- Phase 1 company-shipment investigation and existing BI architecture documents

Reusable strengths:

- Search runs separate lifecycle status from a monotonic user-facing stage.
- Progress counters are persisted and stage-boundary writes are immediate; frequent candidate writes are coalesced.
- Polls are sequential, do not overlap, slow while hidden, and recover from transient read failures.
- Search-run claims/finalization use conditional updates, and the database prevents two active runs per workspace.
- Free-enrichment work is durable, workspace-scoped, bounded to one processing row per capability, retried at most three times, and reclaimed after stale processing.
- Market Intelligence already has a central fail-closed free-provider guard and deterministic selection based on authority, compatibility, coverage, freshness, quota, and a stable provider ID.
- Buyer Intelligence already has strong source, claim, observation, provenance, idempotency, and derived-metric boundaries.

Limits that must not be copied unchanged:

- A Buyer Finder search executes inside one request (`maxDuration = 120`) and is deliberately capped at one Hunter request plus 20 candidates. That cannot safely process hundreds of multi-provider research tasks.
- Search-run staleness is based on `updatedAt > 90 seconds`; a legitimate slow provider call can be falsely treated as interrupted if it does not produce a progress update.
- Free-enrichment stale detection uses `started_at`, not a renewable lease/heartbeat.
- The current autopump asks the server to drain work only while the app is open. It is a convenience, not independent background execution.
- The current Buyer Finder provider cost class is only `free | paid | unavailable`; Phase 2 needs `free | free_quota | manual_free | paid | unsupported`.
- The existing one-row-per-candidate/capability free-enrichment table cannot preserve a multi-provider plan, attempt history, quota decisions, dataset watermarks, cached results, or evidence-dedupe decisions.

## 2. Sources investigated

Fresh official documentation or current product pages were reviewed for:

- ImportYeti API, pricing, credits, errors, MCP mapping, terms, human-usage policy, and data-use policy
- FDA FSVP participant list and workbook
- FDA VQIP public importer list
- FDA Import Refusal Report and downloadable data structure
- FDA import alerts, recalls, warning/compliance resources, and firm/supplier evaluation guidance
- USITC DataWeb's company-data boundary
- CBP manifest access/confidentiality boundary
- USDA/APHIS ACE, ACIR, and eFile boundaries
- Innovation, Science and Economic Development Canada Canadian Importers Database and Open Government datasets
- UN Comtrade / CEPII BACI / OEC as aggregate market-data sources
- ImportInfo, Panjiva, ImportGenius, Volza, and Trademo as public/commercial BOL benchmarks
- Search-engine indexes and public shipment snippets as discovery aids only

Key references:

- [ImportYeti credits](https://docs.importyeti.com/docs/credits), [getting started](https://docs.importyeti.com/docs/getting-started), [pricing](https://www.importyeti.com/pricing/supply-chain), [terms](https://www.importyeti.com/policies/terms), and [data-use policy](https://www.importyeti.com/policies/data-use)
- [FDA FSVP participant list](https://www.fda.gov/food/importing-food-products-united-states/foreign-suppliers-verification-programs-fsvp-list-participants), [FDA import refusals](https://www.fda.gov/industry/fda-import-process/import-refusals), and [FDA supplier-evaluation resources](https://www.fda.gov/food/food-safety-modernization-act-fsma/firmsupplier-evaluation-resources-fsma-rules)
- [USITC company-data FAQ](https://www.usitc.gov/faq/question/where_can_i_find_trade_statistics_and_names_other.htm) and [CBP manifest confidentiality](https://www.help.cbp.gov/s/article/Article-1108)
- [Canadian Importers Database](https://ised-isde.canada.ca/site/ised/en/research-and-business-intelligence/canadian-importers-database), [CID help](https://ised-isde.canada.ca/site/ised/en/canadian-importers-database/help-0), and [Open Government CID search](https://search.open.canada.ca/opendata/?page=1&search_text=Canadian+Importers+Database&sort=score+desc)
- [Supabase Queues](https://supabase.com/docs/guides/queues), [pgmq](https://supabase.com/docs/guides/queues/pgmq), and [Supabase Cron](https://supabase.com/docs/guides/cron)
- [ImportInfo FAQ](https://www.importinfo.com/faq) and [terms](https://www.importinfo.com/terms-of-use)
- [Panjiva shipment search](https://panjiva.com/shipment_search), [ImportGenius pricing](https://w3.importgenius.com/pricing), [Volza pricing](https://www.volza.com/pricing/), [Volza API](https://www.volza.com/trade-intelligence-apis/), and [Trademo pricing](https://www.trademo.com/intel/pricing)

## 3. Sources actually tested

The investigation opened and inspected public documentation, public data pages, access boundaries, pricing pages, terms, and official download metadata. It did not sign in to or create accounts on any provider.

A single safe transport check was made against the FDA's explicitly advertised current Import Refusal ZIP URL:

- `HEAD https://www.accessdata.fda.gov/scripts/importrefusals/downloads/Import_Refusal_2024-present.zip`
- Result: HTTP 200, `application/x-zip-compressed`, 6,070,301 bytes, last modified 2026-09-06.
- The file was not downloaded or stored.

The FDA refusal application's public data-structure page was inspected. It exposes manufacturer FEI/name/address/country, product code/description, refusal date, district, entry/line identifiers, analysis flags, and refusal charges. It does **not** expose the U.S. importer or consignee.

No provider API call was made. No free credit was consumed. No paywall, CAPTCHA, login, robots rule, access control, or hidden endpoint was bypassed. Search snippets were not accepted as evidence.

## 4. Provider matrix

Abbreviations: C = company-level; S = shipment-level; P = product description/category; HS = HS/product code; O = origin; Sup = supplier/exporter; D = date; Q = quantity/weight; Y = supported; N = absent; L = limited/indirect; U = unverified/unknown.

### Data and role matrix

| Provider/source | Roles | C | S | P | HS | O | Sup | D | Q | Coverage / freshness / stable ID |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| FDA FSVP participant workbook | COMPANY_MATCH, OFFICIAL_CORROBORATION, limited TRADE_ACTIVITY | Y | N | N | N | N | N | N | N | U.S. food FSVP participants; quarterly; company name + state, no documented immutable row ID |
| FDA VQIP public list | COMPANY_MATCH, OFFICIAL_CORROBORATION | Y | N | N | N | N | N | N | N | U.S. voluntary fee-program participants; annual/FY list; opt-out/incomplete universe |
| FDA Import Refusal Report | PRODUCT_SIGNAL, SUPPLIER_SIGNAL, OFFICIAL_CORROBORATION/risk | foreign manufacturer | refused entry only | Y | FDA product code, not HS | manufacturer country | manufacturer | Y | N | U.S.-refused FDA-regulated entries; monthly; FEI + entry/line identifiers |
| FDA alerts/recalls/warnings | PRODUCT_SIGNAL, SUPPLIER_SIGNAL, OFFICIAL_CORROBORATION/risk | Y | N | Y | L | L | L | Y | N | Event/list-specific; not comprehensive shipment history; official record identifiers vary |
| Canadian Importers Database | COMPANY_MATCH, TRADE_ACTIVITY, PRODUCT_SIGNAL, ORIGIN_SIGNAL, OFFICIAL_CORROBORATION | Y | N | Y | HS6/HS10 | Y in country report | N | annual period | company values/Q absent | Canadian customs imports; current product report uses 2024 data; names/location; major importers up to ~80% value |
| ImportYeti API | all roles including SHIPMENT_DETAIL | Y | Y | Y | L/Y by record | Y | Y | Y | Y | U.S./Mexico import/export per docs; API slugs/BOL IDs; exact freshness/rate limit U |
| ImportYeti human website | MANUAL_CORROBORATION; all record roles manually | Y | Y | Y | L/Y | Y | Y | Y | Y | Free human U.S. import search; BOL/company identities; ocean/confidentiality limits |
| CBP manifest mechanism | authoritative SHIPMENT_DETAIL source | Y when disclosed | Y | Y | L | Y | Y | Y | Y | U.S. vessel manifests; confidentiality suppressions; identifiers exist; acquisition not a free API |
| ImportInfo | MANUAL_CORROBORATION | Y | Y | Y | L/Y | Y | Y | Y | Y | U.S. ocean BOLs since 2012, stated daily updates; BOL/company IDs |
| Panjiva | commercial benchmark; all shipment roles | Y | Y | Y | Y/L | Y | Y | Y | Y | Global commercial datasets; limited preview; stable vendor IDs likely but not verified for free access |
| ImportGenius | commercial benchmark; all shipment roles | Y | Y | Y | Y/L | Y | Y | Y | Y | U.S./global commercial BOL data; U.S. page states BOL-level; paid download/API |
| Volza | commercial benchmark; all shipment roles | Y | Y | Y | Y | Y | Y | Y | Y | Global vendor data; advertised shipment/API records; IDs U without paid access |
| Trademo | commercial benchmark; all shipment roles | Y | Y | Y | Y/L | Y | Y | Y | Y | Global custom plan; daily U.S., weekly/monthly international per vendor; IDs U |
| USITC DataWeb | MARKET-LEVEL ONLY | N | N | aggregate | Y | country aggregate | N | period | aggregate | Tariff-category statistics; company activity confidential |
| UN Comtrade / BACI / OEC | MARKET-LEVEL ONLY | N | N | aggregate | Y | bilateral country | N | annual/monthly varies | aggregate | Country/product trade, not buyer-company evidence |
| USDA/APHIS ACE/ACIR/eFile | regulatory context only | N public evidence | N | commodity rules | L | country eligibility | N | current rules | N | Filer/permit/requirements systems, not public company shipment datasets |
| Search-engine snippets | discovery aid only | U | U | U | U | U | U | U | U | Unstable index, no durable provenance or coverage |

### Access, automation, and suitability matrix

| Provider/source | API / authentication | Free access / quota | Quota type | Automation/reuse boundary | Paid fallback | Terms risk | Classification / recommended role |
|---|---|---|---|---|---|---|---|
| FDA FSVP workbook | Public XLSX; no API/auth | Free; no published call quota | Bulk quarterly dataset | Intentionally published download; use low-frequency conditional GET and preserve attribution; automated-use terms not separately stated | None | Low/medium | **AUTOMATIC FREE** for exact/strong U.S. food-company corroboration only |
| FDA VQIP list | Public list/page | Free | Small annual/FY list | Public official list; low-frequency refresh | None | Low | **AUTOMATIC FREE**, secondary corroboration only |
| FDA Import Refusal Report | Public query and downloadable CSV/ZIP; no auth | Free; no published call quota | Monthly bulk dataset | FDA explicitly recommends downloading data for supplier/product searches | None | Low | **AUTOMATIC FREE** for foreign supplier/product refusal-risk checks; never successful trade or U.S. buyer proof |
| FDA alerts/recalls/warnings | Public pages/data paths vary | Free | Public official data | Automate only documented feeds/downloads, otherwise manual | None | Low/medium | **AUTOMATIC FREE** where a documented download exists; otherwise **MANUAL ONLY** |
| Canadian Importers Database | Public reports + Open Government XLSX/CSV; no auth | Free/open data | Annual bulk dataset | Open Government data under its stated licence; retain dataset year/licence/version | None | Low | **AUTOMATIC FREE** for Canadian company/product/origin screening |
| ImportYeti API | API key/account | Search nominally free but standalone search can cost 0.1 credit/result; detail 0.1–1+ credits | Purchased data credits; initial and recurring free allowance **UNKNOWN** | API supports automation, but current entitlement and reusable storage rights for free/API use require confirmation | Purchase link exists; must be disabled | High until contract/allowance confirmed | **AUTOMATIC FREE-QUOTA, DISABLED** until allowance, API entitlement, and storage terms are proven |
| ImportYeti human website | Account; human UI | $0, free forever, unlimited **human** U.S. import search, no card | Human-use plan | Terms require human accounts and incorporate Human Usage Policy; free data is outside Purchased Data covenant | Paid plans available | High for automation | **MANUAL ONLY** |
| CBP manifest mechanism | FOIA/public request; no modern free API verified | Request may incur fees/delay | Request-based | Confidentiality and acquisition process prevent routine zero-cost automation | N/A | Medium/high | **UNSUPPORTED** for Phase 2 automation; authoritative origin only |
| ImportInfo | Public preview/UI; no documented free API | Limited public visibility; downloads tied to subscription | Subscription limits | Terms limit protected content to personal use and prohibit unprovided acquisition methods | Subscription auto-bills | High | **MANUAL ONLY**; no automated MDF dependency without written licence |
| Panjiva | Subscription/demo | Limited preview | Paid subscription | Advanced search explicitly subscription-only | Yes | High | **PAID / UNSUITABLE** |
| ImportGenius | Paid product; Enterprise API | Plans from USD 229/month; no durable free API found | Paid monthly/annual | API/data delivery is enterprise | Yes | High | **PAID / UNSUITABLE** |
| Volza | Commercial API/account | 7-day no-card trial advertised; API explicitly priced | Trial credits then paid per search/report/record | Trial is not a durable production allowance; API pricing starts above zero | Yes | High | **PAID / UNSUITABLE**; trial not production quota |
| Trademo | Custom plan/API | No durable free production tier verified | Annual/download/value-add credits | Custom commercial access | Yes | High | **PAID / UNSUITABLE** |
| USITC / Comtrade / BACI | Free/registered APIs vary | Free/free quota for aggregate data | Dataset-specific | Suitable only for market evidence under existing MI contracts | No role here | Low/medium | **MARKET-LEVEL ONLY** |
| USDA/APHIS | Public regulatory pages or authenticated filer systems | Public context | N/A | No public company-evidence feed found | N/A | Low | **UNSUPPORTED** for buyer-trade automation |
| Search snippets | Public search UI | Free | Rate/index dependent | Not an underlying evidence source; automated harvesting not approved | N/A | High | **REJECTED** |

## 5. Confirmed free/free-credit capabilities

Confirmed permanently/publicly free paths:

- FDA FSVP: downloadable quarterly XLSX containing importer name and state.
- FDA Import Refusal Report: monthly public data with downloadable period files for manufacturer, product, refusal date/reason, and official record identifiers.
- FDA VQIP and selected FDA compliance lists: public official corroboration, with narrow/incomplete scope.
- Canada CID/Open Government: annual machine-readable company lists by product, city, and origin country; HS6/HS10 metadata; open-data publication.
- USITC DataWeb and existing Comtrade/BACI paths: free aggregate market data only, not company evidence.
- ImportYeti website: $0, no card, free forever, unlimited **human** U.S. import search. This confirms manual use, not automated production use.

No recurring free-credit detailed-shipment API allowance was confirmed for any provider.

## 6. Unknown or unverified provider claims

The following remain **UNKNOWN** and must fail closed:

- ImportYeti API starting credit balance for a new free account.
- Whether any free ImportYeti API credit balance recurs, and at what interval/amount.
- Whether the API is available to ordinary free accounts despite the pricing page listing API under Enterprise.
- A fixed ImportYeti request-rate limit; the error docs do not publish one.
- Whether free/API results may be persistently stored and reused by MDF under the free account. ImportYeti's broad reuse covenant explicitly applies to Purchased Data, not the free version.
- Stable free identifiers or downloadable coverage for commercial preview products without a contract.
- A modern zero-cost CBP manifest API.
- Any public USDA/APHIS company-import or shipment-detail feed.
- Automated-use terms for public pages that offer no documented bulk download/feed. Those paths remain manual until permission is established.

An unknown free allowance is not a free allowance. `quota_state = unknown` makes a provider ineligible for automatic execution.

## 7. Recommended provider roles

| Source | Approved role | Explicit non-role |
|---|---|---|
| FDA FSVP | Exact/strong company match and official FSVP-importer-program corroboration | Not CBP importer-of-record, product, origin, supplier, or shipment evidence |
| FDA VQIP | Secondary official importer-program corroboration | Not comprehensive and not shipment evidence |
| FDA refusals/alerts | Foreign supplier/product compliance and refusal-risk evidence after a supplier is known | Not successful trade, not U.S. buyer matching, not positive shipment activity |
| Canada CID | Canadian company trade-activity, HS product, and source-country screening | Not individual shipment, supplier relationship, company value/volume, or end-user proof |
| ImportYeti API | Future selective detail only after entitlement, free quota, and storage rights are confirmed | Not current high-volume free screening |
| ImportYeti/ImportInfo public UI | Human exception corroboration | Not automated ingestion |
| USITC/BACI/Comtrade | Market context | Not company evidence |
| Commercial BOL vendors | Capability benchmarks | Never called under the ₹0 contract |

## 8. Zero-cost source-planning algorithm

The user chooses a goal (`screen_trade_activity`, `find_target_product`, or `check_india_origin`). The server chooses sources.

1. Validate the workspace candidate, canonical MDF product, destination market, and requested goal. Browser input cannot select a provider, query syntax, credits, or paid fallback.
2. Build an evidence-gap set from current candidate identity and any staged/approved evidence.
3. Load versioned provider descriptors and current dataset/quota/cache state.
4. Reject descriptors that are disabled, geographically irrelevant, lack a documented capability, have `paid`, `manual_free`, or `unsupported` cost class, have unknown/empty free quota, have unresolved terms/storage rights, or would exceed the global ₹0 invariant.
5. Reuse a fresh compatible cache entry before planning any external fetch.
6. Prefer local bulk datasets already fetched under their cadence:
   - U.S. food candidate: FDA FSVP exact/strong name + state check; VQIP only as secondary.
   - Canadian candidate: CID HS product report; if the goal is India origin, use the matching HS + origin-country dataset.
   - Known foreign supplier: FDA refusals/alerts for compliance/product risk, never as positive import proof.
7. Stop when no credible entity match exists. Do not spend scarce quota to rescue a fuzzy name.
8. Classify trade activity, product A/B/C, and India/Guntur separately. Stop or produce a low-information result when the requested gap is already resolved.
9. A future `free_quota` detailed call is eligible only when all are true: exact/strong entity match; useful trade/product signal; the detail could resolve a material missing field; the endpoint's maximum credit cost is known; a free-credit reservation succeeds; the returned balance can be reconciled; storage/automation terms are approved.
10. Send ambiguous entity matches, conflicting product text/HS, probable duplicates, and unsupported origin/Guntur claims to review.

Deterministic ordering uses: cached result, official source authority, exact role match, product/geography compatibility, data freshness, known free quota, then provider ID. It never uses a hidden predictive score or a blind provider waterfall.

## 9. Quota/credit strategy

Quota is a first-class execution gate, not an after-the-fact metric.

- Provider descriptors declare cost class, endpoint cost formula, currency/credit unit, maximum possible request cost, reset behavior, quota source, paid-fallback flag (always false), and last verification time.
- `free` bulk sources use conservative dataset refresh cadences (quarterly FDA FSVP, monthly FDA refusals, annual Canada CID), conditional requests, and one shared cached dataset rather than one download per candidate.
- `free_quota` calls require a transactional reservation against a persisted observed free balance. Unknown balance, unknown endpoint cost, expired observation, or insufficient remaining quota means `skipped_quota`.
- Reconcile each response's reported cost and balance. A provider charging more than reserved disables that provider and raises an operational alert.
- A quota/403 response is not retried as a network failure and cannot fall through to purchase.
- Trials are not assumed to recur and are not production dependencies.
- Infrastructure usage is also bounded. Existing Supabase/Vercel plan limits and spend caps must be verified before Phase 2 scheduling; the application pauses rather than causing plan overage.
- Future storage should enforce `automatic_spend_rupees = 0` with a database check and reject any non-zero write.

ImportYeti-specific decision: standalone company search can cost 0.1 credit per returned record; profile costs 1 credit; BOL list/product/PowerQuery costs 1 per 10 records; individual BOL costs 0.1. Because initial/recurring allowance and API entitlement are unknown, its automatic quota is currently zero.

## 10. Caching strategy

Cache two different things:

1. **Dataset snapshots** — FDA FSVP, FDA refusals, Canada CID. Key by provider, dataset ID, published period/version, retrieval method, and licence/terms version. Preserve URL, ETag/Last-Modified where available, material hash, fetched/retrieved time, coverage, row count, and parse version.
2. **Provider/query results** — key by provider, provider dataset version, normalized company identity, country, product/HS scope, requested role, and query fingerprint. Preserve provider record IDs, source watermark, result hash, access/cost class, quota decision, and classifier version.

Fresh positive results are replayed deterministically. Negative results get a shorter TTL because an absent company can appear in a later dataset. A new dataset watermark, material identity change, product classifier version, or terms change invalidates compatible reuse. Raw payloads are stored only when the licence permits; otherwise retain normalized facts and a safe reference or mark the result manual-only.

## 11. Entity-resolution strategy

Output exactly one decision: `exact`, `strong`, `ambiguous`, `rejected`, or `none`.

- Exact: legal/official name plus exact address, domain, or provider-stable identity.
- Strong: normalized name plus consistent city/state/country and at least one independent domain/address/phone/DBA-parent signal.
- Ambiguous: name-only, conflicting location, unexplained subsidiary/DBA, or multiple plausible entities.
- Rejected: contradictory identity or a match based only on product/category similarity.
- None: no credible provider record.

Normalization may standardize case, punctuation, whitespace, legal suffixes, `www`, and phone/address formatting. It may not infer corporate ownership or merge locations. Only exact/strong evidence can affect company-specific intelligence. Ambiguous evidence is quarantined and does not become a BI claim.

## 12. Product-classification strategy

Preserve the Phase 1 deterministic A/B/C contract:

- A: explicit dried red chilli/chili/chile peppers or an equivalent direct target description.
- B: red bell pepper, jalapeño, paprika, ambiguous Capsicum, or another related pepper product.
- C: spices, seasonings, food products, agricultural products, or otherwise insufficient text.

Raw commodity text remains authoritative. HS 090421 can strengthen an A decision, but it cannot override a conflicting raw description. `HS 090421 + ORGANIC DEHYDRATED RED BELL PEPPER` remains B. Store classifier version and the exact raw text/HS supporting every decision.

## 13. India/Guntur strategy

- India requires an underlying accepted company-specific record or an official company/product/origin dataset row connecting that candidate and relevant product to India.
- A supplier's country or an aggregate company chart does not automatically establish that the target shipment originated in India.
- India relationship for a different product remains separate from India-origin chilli evidence.
- India + dried chilli + HS 090421 still does not prove Guntur.
- Guntur requires explicit Guntur text in the same record or a separately durable, unambiguous company-specific link to that product/record.

No planner stage may promote one of these levels into the next.

## 14. Cross-source deduplication strategy

1. Exact duplicate: same provider + stable record ID, or the same authoritative BOL/manifest/entry-line identifier. Idempotently link the existing evidence item.
2. Strong cross-source duplicate: exact/strong candidate identity plus shipper, arrival date, origin/destination ports, quantity/weight, and materially equivalent raw commodity. Merge only when the combination is sufficiently complete and non-conflicting.
3. Probable duplicate: missing identifier or partial/conflicting composite. Keep separate records, assign a duplicate-cluster candidate, and require review.

The canonical cluster preserves every source link, raw value, discrepancy, retrieval time, and provider coverage. Deduplication never erases provenance and never uses HS alone.

## 15. Automation coverage assessment

| Scenario | Expected automation | Why |
|---|---|---|
| Canadian candidates for a known HS product and origin | High for coarse screening | CID directly supplies major company names by HS product/origin, but only annually and without shipment detail |
| U.S. food candidates needing importer-program corroboration | Moderate for coarse screening | FSVP name/state matching is machine-readable and quarterly, but product/origin/shipment are absent |
| Known foreign food suppliers needing refusal/compliance review | Moderate/high for that narrow risk goal | FDA provides monthly product/manufacturer/refusal data, but it is negative evidence |
| Current U.S. chilli candidates needing positive target-product/India shipment proof | Low | No broad legitimate free automated U.S. consignee/product/shipment feed was found |
| Detailed global shipment history | Low | Tested comprehensive services are paid or manual/preview-only |

This materially reduces repetitive dataset lookups and obvious mismatches, but it does not eliminate detailed U.S. shipment research.

## 16. Batch-processing architecture

Use a database-backed, resumable work system, never hundreds of browser-held requests.

- A batch creates one parent batch plus bounded candidate research jobs.
- A dispatcher claims small slices, respecting per-provider and global concurrency. Start at one worker per provider; increase only after measured rate/latency evidence.
- Each server invocation works for a bounded budget (for example, 20–40 seconds inside a 60-second route/worker limit), checkpoints after every provider transition, then requeues remaining work.
- Dataset fetch jobs are shared: download/parse FDA or Canada data once per published version, then run local candidate matching without network calls.
- Candidate jobs remain independent; one slow/failing provider cannot block the batch.
- Browser polling is read-only. Navigating away does not cancel or erase work.
- Cancellation uses `cancel_requested_at`; workers check it before each provider step and before requeue. Already completed evidence is retained, unfinished attempts become cancelled, and the batch can finish as partial/cancelled.
- PGMQ is a credible future queue option because it is Postgres-native, durable, uses visibility timeouts, and supports archive/replay. Supabase Cron can trigger bounded drains. Phase 2 must first verify the project's Postgres version, extension availability, plan quotas, and spend-cap settings. Existing tables plus conditional claims remain the fallback; no new service is assumed in this phase.

## 17. Research job state machine

Use orthogonal `status`, `stage`, and `outcome` fields.

Lifecycle status:

- Active: `queued`, `running`, `cancel_requested`
- Terminal: `completed`, `partial`, `needs_review`, `quota_limited`, `failed`, `cancelled`

Monotonic stage:

`preparing_identity → planning_sources → screening_sources → resolving_company_matches → checking_trade_activity → checking_product_evidence → checking_origin_evidence → performing_deep_lookup → deduplicating_evidence → classifying_evidence → finalizing → complete`

Legal transitions:

- `queued → running | cancelled`
- `running → running` with same/forward stage, or `cancel_requested | completed | partial | needs_review | quota_limited | failed`
- `cancel_requested → cancelled | partial` after the current safe checkpoint
- Terminal rows are immutable. Explicit rerun creates a new job linked by `supersedes_job_id`; it does not erase history.
- Stage may stay the same during retries or multiple provider attempts, but never move backward.
- `quota_limited` is appropriate only when the requested useful work could not run because confirmed free quota was unavailable and no sufficient result exists. Useful evidence plus a skipped provider finishes `partial`, not `quota_limited`.

User-facing outcome is separately classified as `verified_target_evidence`, `related_product_evidence`, `trade_activity_only`, `no_verified_evidence`, `needs_review`, `quota_limited`, `partial`, or `failed`.

## 18. Provider sub-state machine

Provider plan/attempt states:

`planned → ineligible | queued`  
`queued → running | cancelled`  
`running → completed | completed_no_match | skipped_cached | skipped_quota | skipped_cost | skipped_terms | failed_retryable | failed_terminal | cancelled`  
`failed_retryable → retry_wait → queued | failed_terminal | cancelled`

Terminal attempt rows are never reset. A retry creates a new attempt (or increments an immutable attempt sequence) linked to the plan item. Eligibility decisions preserve reason code, descriptor version, cost/quota snapshot, cache decision, and planner version.

`skipped_cost` and `skipped_terms` are successful safety decisions, not provider failures. `completed_no_match` means the provider was actually checked within its declared coverage; it does not mean the company has no trade activity.

## 19. Heartbeat, stale, and retry contract

Persist `lease_owner`, `lease_expires_at`, `heartbeat_at`, `last_progress_at`, and an optimistic `revision` separate from ordinary `updated_at`.

- Claim atomically with an RPC/transaction and row lock or `FOR UPDATE SKIP LOCKED`; use advisory locking per job/provider where appropriate.
- Start with a 60-second lease renewed every 15–20 seconds during active work. Provider adapters must heartbeat during long local parsing and use bounded HTTP timeouts.
- A job is stale only when its lease has expired, heartbeat is older than the grace threshold, and no provider attempt holds a fresh lease. UI reads and metadata edits never refresh liveness.
- Reclaim by compare-and-set on job ID, status, revision, prior lease owner, and expired lease. Never finalize solely because `updated_at` is old.
- Retry timeouts, connection resets, 429, and eligible 5xx up to three total attempts with persisted backoff (initially 30 seconds, then 2 minutes, then terminal) and jitter.
- Do not retry invalid input, identity rejection, unsupported capability, terms/config errors, or ordinary 4xx. Authentication/config errors are terminal until configuration changes.
- Quota 403 becomes `skipped_quota`, not a generic retry. Every retry rechecks entitlement, free quota reservation, terms, and ₹0 invariant.
- Partial success keeps valid completed evidence when another provider fails.

## 20. Frontend loader contract

| Persisted backend state | User text | Truth condition |
|---|---|---|
| queued / preparing_identity | Preparing company identity | Job exists and canonical candidate inputs are being validated |
| planning_sources | Selecting eligible free sources | Provider descriptors, cache, terms, geography, and quota are being evaluated |
| screening_sources | Checking free trade sources | At least one eligible cached/bulk/provider plan item is being evaluated |
| resolving_company_matches | Matching company records | Entity resolver is processing returned/source dataset identities |
| checking_trade_activity | Checking company trade activity | Accepted exact/strong company evidence is being classified for trade activity |
| checking_product_evidence | Looking for relevant product evidence | Raw product text/HS is being classified A/B/C |
| checking_origin_evidence | Checking India-origin evidence | Accepted product evidence is being evaluated for record-level origin |
| performing_deep_lookup | Checking detailed shipment evidence | An eligible, reserved zero-cost detail attempt is actually running |
| deduplicating_evidence / classifying_evidence | Verifying evidence | Dedupe/provenance/outcome classification is executing |
| finalizing | Finalizing trade intelligence | Counters, safe result, and terminal state are being persisted |
| complete + completed | Research complete | All planned eligible work is terminal and result persisted |

Completed checkmarks come only from persisted stage-boundary completion; the current stage is active and later stages remain pending. There are no artificial delays or fake percentages.

On partial completion, show the useful result plus “Some free sources could not be checked” and a details link. On quota exhaustion, show “Detailed source skipped — free quota unavailable — no charge made.” On failure, retain the last truthful completed stage and a safe retry message. Polling uses the existing sequential visible/hidden cadence and resumes from persisted state after refresh.

## 21. Batch progress UX

Display counts derived from persisted jobs, never elapsed-time estimates:

```text
Researching 100 candidates
Completed: 38   In progress: 4   Queued: 58
Target evidence found: 7   Related evidence: 14   Needs review: 3
₹0 spent
```

Show percentage only when the denominator is a persisted, closed set of candidate jobs; label it batch completion, not provider progress. An individual drawer can show stage steps and source details. Batch failure does not overwrite completed candidate results. Quota-limited and needs-review counts are separate from no-evidence.

## 22. Zero-cost UX

- Normal workflow says “Free research” and displays `₹0 spent` from the persisted monetary-spend invariant, not a hard-coded label.
- Provider choice, credentials, and credits stay out of the standard UI.
- A source skipped for quota/cost/terms is explained without implying absent company activity.
- No button can enable paid fallback. Any future provider configuration remains owner-only and server-side.
- Batch start performs a preflight; if any planned source cannot prove zero monetary cost, it is removed before the first job runs.

## 23. Observability model

Use structured, append-only safe job events plus current-state rows. Safe fields:

- research/batch/job/attempt ID
- workspace-scoped candidate ID (not contact details)
- provider ID and descriptor/planner/classifier version
- old/new status and stage
- duration, attempt number, retry-at time, timeout class
- cache hit/miss and dataset watermark
- result category and record count
- quota decision, reserved/actual free-credit units, and `automatic_spend_rupees = 0`
- safe normalized error code, not raw provider body

Never log API keys, authorization headers, cookies, JWTs, raw secrets, full provider payloads, unnecessary contacts, or sensitive personal data. Metrics should cover queue age, active leases, stale reclaims, provider latency/outcomes, cache hit rate, quota skips, review rate, and zero-spend invariant violations. An invariant violation disables the adapter and alerts operators.

Supabase observability should use current supported Logs Explorer/ClickHouse paths when needed; no architecture should depend on the removed legacy `logs.all` Management API.

## 24. Existing schema/job-system fit

Reuse:

- Buyer Finder's workspace isolation, authenticated internal routes, sequential polling, monotonic stage presentation, coalesced progress, bounded concurrency, conditional claim/finalize style, retry vocabulary, and safe errors.
- Market Intelligence's static provider descriptors, centralized free-only execution check, quota awareness, deterministic selector, and versioned policy.
- Buyer Intelligence sources/claims/trade observations for **later approved evidence ingestion**, including source records, raw product/HS, supplier, dates, origin, quantities/weights, ports, access/cost class, and normalization version.
- Buyer Intelligence's rule that only actual company-specific shipment/transaction evidence is Level 1.

Do not overload:

- `buyer_finder_search_runs`: it models one bounded discovery run, not multi-source research.
- `buyer_finder_free_enrichment_jobs`: its capability enum/current-state row has no provider plan/attempt/cache/quota/provenance history.
- BI source/claim/observation tables during research: Phase 1.5 must not write production intelligence, and ambiguous/staged findings need quarantine before approval.

## 25. Proposed schema/storage gaps

Phase 2 should propose an additive migration only after review. Likely storage boundaries:

- `buyer_trade_research_batches`: requested goal/product, counters, status, zero-spend aggregate, cancellation.
- `buyer_trade_research_jobs`: one candidate/product/country request, status/stage/outcome, planner/classifier versions, lease/heartbeat/revision, result summary, parent/rerun link.
- `buyer_trade_research_provider_plans`: deterministic eligibility decision, roles, order, descriptor/terms/quota/cache snapshots, skip reason.
- `buyer_trade_research_attempts`: immutable attempt sequence, provider state, lease/timing, safe error/result counts, free-credit reservation/actual cost.
- `buyer_trade_source_snapshots` and/or cache metadata: dataset/query fingerprint, watermark, material hash, coverage, freshness, terms/licence version, parse version, safe payload location when permitted.
- `buyer_trade_quota_ledger`: observed free balance/reset, reservations, reconciliation, provider/account scope; no secret material.
- `buyer_trade_research_evidence_staging`: quarantined normalized facts and raw provenance before BI ingestion.
- `buyer_trade_duplicate_clusters`: exact/probable links and review decision.
- `buyer_trade_research_events`: append-only safe transition/audit log.

Database invariants should include workspace-scoped foreign keys, one active job per candidate/product/goal, one active attempt per provider plan, nonnegative counters, monotonic attempt number, `automatic_spend_rupees = 0`, RLS, explicit grants, and server-only mutation functions. New Supabase public-schema tables are not assumed to be Data API-accessible; grants and RLS must be explicit. If progress later uses Realtime, authorize only through supported Realtime policies—do not create custom objects in the managed `realtime` schema.

## 26. Migration required now

**NO.** Existing storage is sufficient to complete this investigation, and the new job model requires product review before schema commitment. No migration was created or edited.

## 27. Production writes

**ZERO.** No Supabase production row, Buyer Finder candidate, Buyer Intelligence source/claim/observation, job, or provider state was written.

## 28. Paid provider calls

**ZERO.** ImportYeti, ImportInfo, Panjiva, ImportGenius, Volza, Trademo, BotMarket, and every other paid/credit-consuming provider endpoint were not called.

## 29. Experimental calls and files

- Network experiment: one public FDA ZIP `HEAD` request; no body downloaded and no data stored.
- Documentation page requests: read-only web access to official/current pages listed above.
- Provider API calls: zero.
- New file: this architecture report only.
- Existing Phase 1 report remains unchanged.
- Validation: documentation structure and repository status were checked; no full Vitest, TypeScript, or build run was required for a documentation-only investigation.

## 30. Recommended Phase 2 implementation sequence

### Phase 2A — job foundation + one official screening adapter

- Review/propose migration for jobs, plans, attempts, events, leases, zero-spend invariant, and dataset cache.
- Implement versioned provider descriptors and fail-closed planner.
- Add one low-risk bulk source, preferably FDA FSVP for U.S. food screening, with fixtures and no BI ingestion.
- Add truthful polling/loader and owner-only bounded batch start/cancel.

### Phase 2B — product/origin classification

- Implement raw-text-first A/B/C classifier, India/Guntur separation, conservative entity resolver, and test fixtures.
- Add Canada CID adapter for Canadian-market candidates if that market is in immediate product scope.

### Phase 2C — selective free-quota detail

- Do not implement until a provider gives written/documented API entitlement, recurring/one-time free allowance, exact endpoint costs, automation permission, and storage/reuse rights.
- Add quota reservation/reconciliation, never-paid retries, and a controlled fixture/dry run before any live request.

### Phase 2D — human exception review

- Add review only for ambiguous identities, probable duplicates, conflicting product/HS, and unverified origin/Guntur. Do not turn the product into a manual-first workflow.

### Phase 2E — controlled Buyer Intelligence ingestion

- Map only reviewed/eligible staged evidence into existing BI source/claim/observation contracts.
- Preserve source record IDs, raw facts, coverage, access/cost class, watermarks, and normalization versions.
- Keep compliance/refusal evidence at the correct level; never make it a successful shipment observation.

## 31. GO / NO-GO for automatic free screening

**GO — narrow and conditional.** At least one legitimate path exists: FDA FSVP for U.S. food importer-program corroboration, FDA refusal data for known foreign supplier/product risk, and Canada CID for Canadian company/product/origin screening. The UI and evidence model must label each source's limited semantics precisely.

This is not a GO for generic U.S. company shipment screening. For current U.S. chilli Buyer Finder candidates, the useful automatic result will often stop at company/importer-program corroboration.

## 32. GO / NO-GO for automatic detailed shipment evidence

**NO-GO at ₹0 for broad production use.** No tested source provides a durable, comprehensive, legitimate, automated, zero-cost company/BOL detail feed with confirmed reuse rights. ImportYeti may become a **selective free-quota** option only after allowance, API entitlement, automation, and storage rights are explicitly confirmed. Paid fallback remains prohibited.

## 33. Estimated remaining human-review burden

- Low-to-moderate for coarse Canadian HS/origin screening and exact FDA FSVP company matches.
- Moderate for ambiguous company identities, compliance-list interpretation, and probable cross-source duplicates.
- High for positive detailed U.S. dried-chilli shipment, India-origin, supplier, and Guntur verification under the current ₹0 constraint.

Humans should review exceptions and detailed claims, not re-run all official dataset searches. No honest exact percentage is supportable before a representative candidate batch is run against the proposed official adapters.

## 34. READY FOR BI4F PHASE 1.5 REVIEW

**YES.** The source boundary, zero-cost planner, quota/cache model, state machines, batch architecture, UI contract, storage proposal, and Phase 2 sequence are ready for review. Production implementation, migration, BI ingestion, and paid provider enablement have not started.
