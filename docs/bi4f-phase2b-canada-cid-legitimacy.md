# BI4F Phase 2B — Canada CID Source Legitimacy Investigation

Status: **INVESTIGATION COMPLETE — READY FOR CONTROLLED PRODUCTION QA (scaffold only)**
Research date: 2026-09-27
Automatic monetary spend: **₹0 hard limit — preserved**

---

## Purpose

Before Phase 2B implements the Canadian Importers Database (CID) as a second Phase 2A-style provider, document the source's actual semantics, licensing, and capability boundary. **No adapter is built until every question below is answered.**

## 1. Exact official source

**Canadian Importers Database (CID)** — Government of Canada.
Landing page: `https://ised-isde.canada.ca/site/ised/en/research-and-business-intelligence/canadian-importers-database`
Help page: `https://ised-isde.canada.ca/site/ised/en/canadian-importers-database/help-0`
Bulk data catalogue: `https://search.open.canada.ca/opendata/?search_text=Canadian+Importers+Database`

## 2. Publisher

**Innovation, Science and Economic Development Canada (ISED)**, using data collected by the **Canada Border Services Agency (CBSA)**. Statistics Canada is cited as an additional source on the landing page.

## 3. Access method

Two independent access paths:

- **Interactive HTML query interface** on the ISED site (three entry points: "Importers by product", "List by city", "List by country"). Returns HTML tables of major importers by HS product / geography.
- **Bulk downloadable files** on the Open Government catalogue. Format is primarily **CSV**, with **XLSX + XLS** for the 2018 release. Multiple years published as separate dataset records; 40 total records currently indexed under the "Canadian Importers Database" query on `search.open.canada.ca`.

## 4. Update cadence

Open Government Update Frequency filter: **Annually** (19 records). The latest CID year visible on the Open Canada catalogue as of 2026-09-27 is **2022** (dataset released 2024-01-24, record last modified 2026-07-15). The ISED landing page references "2024 data" for the main product listing and "2023 data" for city/country lists.

**Practical cadence for automation: annual bulk release; refresh window ≥ 12 months.**

## 5. Fields available (with confidentiality suppressions)

| Field | Present? | Notes |
|---|---|---|
| Company name | **Yes** | Only for major importers. |
| City | Yes | |
| Province | Yes | |
| Postal code | Yes | |
| HS product code | **Yes** — HS6, with drill-down to 10-digit product | 5000 different products, 96 HS chapters. |
| Country of origin | **Yes** | Available in "List by country" reports. |
| Shipment date | **No** | Not present. |
| Per-shipment quantity | **No** | Not present. |
| Per-company quantity | **No — explicitly suppressed** | Help page: "import quantities or dollar values for individual companies are not divulged". |
| Per-company value | **No — explicitly suppressed** | Only aggregate market share (cumulative %). |
| Supplier / exporter | **No** | Not present. |
| Individual (non-company) names | **No — explicitly suppressed** | Help page: "names of individuals are not divulged". |

Additional CID confidentiality rules the adapter MUST respect:
- No importer list is released for a city / product combination with fewer than 3 importers.
- If one importer represents ≥ 80 % of a city's imports for a product, the entire report is suppressed.
- Importers without importer numbers are excluded from the dataset.

## 6. Company names present

**Yes**, but only for "major importers" who collectively account for up to ~80 % of imports for a specific product / city.

## 7. Product descriptions / HS codes present

**Yes.** HS6 as primary key, with drill-down to 10-digit for finer resolution. HS coverage: 5000 products across 96 chapters.

## 8. Origin / export country present

**Yes**, but only through the "List by country" query and its corresponding Open Government bulk file. Not present in every CID row — origin is a query dimension, not a shipment field.

## 9. Dates / periods present

**Only at dataset granularity** (dataset year). No per-shipment or per-row date column.

## 10. Shipment rows vs. registrations / directories

**Directory / aggregation — not shipments.** CID lists companies who are major importers of specific HS products from specific origin countries in a given year. It does not enumerate individual shipments. **This is the critical semantic boundary that Phase 2B must never cross.**

## 11. Automation / reuse allowed

**Yes**, under the Open Government Licence – Canada v2.0 (see 13 below). The bulk files on Open Canada are explicitly published for reuse, including commercial use, redistribution, and modification.

## 12. Genuinely free

**Yes.** No subscription, no paywall, no login, no API key, no captcha. Open Government content is free of monetary charge. All Phase 2A ₹0-hard-limit constraints continue to hold.

## 13. Rate limits

**No rate limit is published** on the ISED CID pages or the Open Government catalogue. The Open Canada catalogue records themselves are marked "API enabled: No" (38 of 40 CID-query records). The bulk files are static URLs — an adapter should:
- fetch each new dataset year at most once (annual cadence);
- use ETag / Last-Modified conditional requests when the server supports them;
- respect a small default `User-Agent` and no aggressive concurrency;
- never re-download a file whose material hash matches the current snapshot.

## 14. Cachability

**Yes.** Bulk files are static, versioned by dataset year, and licensed for redistribution and modification. `buyer_trade_source_snapshots` is the appropriate cache table (`provider_id = "canada-cid"`, `dataset_id = "cid-by-country-<year>"` etc., unique on `(provider_id, dataset_id, material_hash)`). Suggested cache TTL: **365 days** (one full dataset cycle).

## 15. Semantics matrix

| Evidence class | Supported by CID? |
|---|---|
| Company evidence (identity: name + location) | **Yes** for major importers only. Small importers are absent. |
| Product evidence (HS-level trade activity in a specific product) | **Yes** at HS6/HS10 aggregate; no per-shipment product proof. |
| Origin evidence (country of origin) | **Yes**, only from "List by country" data. |
| Shipment evidence (BOL, arrival date, quantity, value, supplier) | **No.** Explicitly suppressed. Automating CID as shipment evidence would be a fabrication. |

## 16. Licence

**Open Government Licence – Canada, v2.0.**
- Grant: `worldwide, royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes, subject to the terms below.`
- Permitted uses: copy, modify, publish, translate, adapt, distribute, or otherwise use the Information in any medium, mode, or format for any lawful purpose.
- **Attribution obligation**: acknowledge the source; when none specified, use exactly `"Contains information licensed under the Open Government Licence – Canada."`
- Exclusions: no right to Personal Information; no use of ISED / provider names, crests, logos, or official marks; no third-party IP.
- Non-endorsement: reuse must not suggest official status or endorsement.
- Warranty: "as is".

## 17. Evidence semantics contract (Phase 2B, to be enforced by adapter)

- `officialProgramEvidence` — **not applicable to CID.** FDA FSVP retains sole ownership of that field.
- `productEvidence` (new Phase 2B field, to be added when the adapter is scheduled):
  - `verified` — company + HS6 + year present in CID.
  - `supporting` — company + HS parent present but drilldown missing.
  - `no_verified_match` — company not in CID for the product / year.
  - `not_available` — provider ineligible for candidate (e.g. US candidate).
- `originEvidence` (new Phase 2B field):
  - `verified` — company + origin country present in the CID "List by country" report.
  - `supporting` — HS-level product-origin present but company row is absent.
  - `no_verified_match` — no company row for the origin.
  - `not_available` — provider ineligible.
- `shipmentEvidence` — remains `not_verified` under CID. **The adapter must never populate this field from CID.**

New result-summary field literals ("verified" / "supporting" / "no_verified_match" / "not_available") require widening `TradeResearchResultSummary` and the corresponding SQL enum literals — additive only, not migration-blocking, but tracked as **deferred implementation work** for the controlled QA phase.

## 18. Provider descriptor (scaffold, disabled by default)

Registered in [src/lib/tradeResearch/providers.ts](../src/lib/tradeResearch/providers.ts):

| Field | Value |
|---|---|
| `id` | `canada-cid` |
| `displayName` | `Canadian Importers Database` |
| `version` | `canada-cid-v1` |
| `costClass` | `unsupported` **(feature-flag gate)** — the planner refuses eligibility until this is intentionally flipped to `free` in a controlled phase. |
| `countries` | `["CA"]` |
| `roles` | `["COMPANY_MATCH", "PRODUCT_SIGNAL", "ORIGIN_SIGNAL", "OFFICIAL_CORROBORATION"]` |
| `automationAllowed` | `true` (Open Government Licence permits automation) |
| `termsApproved` | `true` (OGL v2.0 approved for MDF reuse with attribution) |
| `termsVersion` | `ogl-canada-v2.0` |
| `datasetCadence` | `annual` |
| `cacheMaxAgeDays` | `365` |

The descriptor is **exported** so the planner sees it, but `costClass = "unsupported"` makes it planner-ineligible for Phase 2A production. This is the intentional "READY FOR CONTROLLED PRODUCTION QA" state: the source has been documented and gated, the actual adapter (fetcher, parser, matcher, result-type widening) is scheduled as follow-on work under a separate, reviewed brief.

## 19. What Phase 2B may NOT do until adapter is scheduled

- **No production fetch.** No HTTP request to `ised-isde.canada.ca` or `open.canada.ca` from any deployed code path.
- **No snapshot writes.** `buyer_trade_source_snapshots` remains sole FDA FSVP for now.
- **No result-summary widening.** `productEvidence` / `originEvidence` new literals stay documented, not persisted.
- **No worker changes.** `processTradeResearchJob` currently processes exactly one eligible plan; multi-provider iteration is deferred.
- **No migration.** 0025 and 0026 remain immutable. If widened result literals are required later, they will be an additive 0027 — not started here.
- **No BI ingest.** Trade research remains isolated from Buyer Intelligence.
- **No paid provider fallback.** ₹0 invariant intact.

## 20. Controlled production QA plan (exact steps, when adapter phase begins)

**Step 1 — pre-adapter dry run (this closeout):**
```bash
npx vitest run --pool=forks --poolOptions.forks.singleFork=true
npx tsc --noEmit --incremental false
npm run build
```
Expect: all green. Static-scan tests assert Canada CID descriptor is planner-ineligible under the current `costClass = "unsupported"` gate.

**Step 2 — adapter implementation (separate phase, out of scope for this closeout):**
- Write `src/lib/tradeResearch/canadaCid.ts` with `fetchCanadaCidByCountryReport(year, hs6, origin)` and `parseCanadaCidCsv(bytes)`.
- Widen `TradeResearchResultSummary` (new literal enum for `productEvidence`, `originEvidence`).
- Extend `TradeResearchWriter.getEligiblePlan` to return multi-provider plans in `sequence` order.
- Extend `processTradeResearchJob` to loop over eligible plans, gating each with `checkpointIfBudgetLow(requiredMs)`.
- Add matcher `matchCanadaCidCompany({ companyName, city, province, rows })`.
- Add attribution to result payload: `"Contains information licensed under the Open Government Licence – Canada."`.

**Step 3 — controlled QA on a single Canadian candidate:**
- Owner console:
  ```js
  fetch("/api/internal/trade-research/drain", { method: "POST", credentials: "same-origin" })
  ```
- Expect: `outcome: "processed", claimed: 1, sourcesChecked: 1, automatic_spend_rupees: 0`.
- Verify `buyer_trade_source_snapshots` has one new row with `provider_id: "canada-cid"` alongside the existing FDA row (**snapshot count 2**, not the FDA row overwritten).

**Step 4 — reversal path if QA fails:**
- Flip `CANADA_CID_DESCRIPTOR.costClass` back to `"unsupported"` — planner refuses; production behaviour reverts to Phase 2A.

## 21. Verdict

**GO on legitimacy — NO-GO on shipment claims — GATED for controlled QA.**

CID is a legitimate, zero-cost, automation-eligible source under OGL Canada v2.0, and its company + HS + origin fields are genuinely useful for Canadian buyer research. It has no shipment-level, quantity, value, supplier, or per-company financial data, and its confidentiality suppressions mean small importers are absent. Phase 2B may adopt it — under a separate adapter phase — only for company / product / origin corroboration, never as shipment evidence.
